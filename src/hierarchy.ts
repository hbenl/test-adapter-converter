import * as vscode from "vscode";
import { RetireEvent, TestAdapter, TestEvent, TestInfo, TestLoadFinishedEvent, TestLoadStartedEvent, TestRunFinishedEvent, TestRunStartedEvent, TestSuiteEvent, TestSuiteInfo } from "vscode-test-adapter-api";

export interface TestAdapterItem extends vscode.TestItem {
    id: string;
    children?: TestAdapterItem[];
}

const schemeMatcher = /^[a-z][a-z0-9+-.]+:/;
function stringToUri(file: string): vscode.Uri {
    if (schemeMatcher.test(file)) {
        return vscode.Uri.parse(file);
    } else {
        return vscode.Uri.file(file);
    }
}

const convertedStates = {
    running: vscode.TestRunState.Running,
    passed: vscode.TestRunState.Passed,
    failed: vscode.TestRunState.Failed,
    skipped: vscode.TestRunState.Skipped,
    errored: vscode.TestRunState.Errored,
    completed: vscode.TestRunState.Unset,
};

export class ConvertedTestHierarchy implements vscode.TestHierarchy<TestAdapterItem> {

    private readonly disposables: vscode.Disposable[] = [];
    private readonly items = new Map<string, TestAdapterItem>();
    private readonly allRunningTests = new Map<string | undefined, TestAdapterItem[]>();
    private readonly runningSuites = new Map<string | undefined, TestAdapterItem[]>();

    readonly root: TestAdapterItem;

    private readonly onDidDiscoverInitialTestsEmitter = new vscode.EventEmitter<void>();
    readonly onDidDiscoverInitialTests: vscode.Event<void>;

    private readonly onDidChangeTestEmitter = new vscode.EventEmitter<TestAdapterItem>();
    readonly onDidChangeTest: vscode.Event<TestAdapterItem>;

    constructor(
        public readonly adapter: TestAdapter
    ) {
        this.disposables.push(this.onDidDiscoverInitialTestsEmitter);
        this.disposables.push(this.onDidChangeTestEmitter);

        this.onDidDiscoverInitialTests = this.onDidDiscoverInitialTestsEmitter.event;
        this.onDidChangeTest = this.onDidChangeTestEmitter.event;

        this.root = {
            id: "root",
            label: "root",
            state: new vscode.TestState(vscode.TestRunState.Unset)
        };

        this.adapter.tests(e => this.onTestLoadEvent(e), this.disposables);
        this.adapter.testStates(e => this.onTestEvent(e), this.disposables);
        this.adapter.retire?.(e => this.onRetireEvent(e), this.disposables);

        this.adapter.load();
    }

    onTestLoadEvent(e: TestLoadStartedEvent | TestLoadFinishedEvent): void {

        if (e.type === "finished") {

            const location = e.suite ? this.convertLocation(e.suite) : undefined;
            const messages: vscode.TestMessage[] = [];
            if (e.errorMessage) {
                messages.push({
                    message: e.errorMessage,
                    severity: vscode.TestMessageSeverity.Error,
                    location
                });
            }

            this.items.clear();

            this.root.id = e.suite?.id || "root";
            this.root.label = e.suite?.label || "root";
            this.root.description = e.suite?.description;
            this.root.location = location;
            this.root.debuggable = !!this.adapter.debug && !!e.suite?.debuggable;
            this.root.state = new vscode.TestState(vscode.TestRunState.Unset, messages);
            this.root.children = this.convertTests(e.suite?.children || []);

            this.items.set(this.root.id, this.root);

            this.onDidChangeTestEmitter.fire(this.root);
            this.onDidDiscoverInitialTestsEmitter.fire();
        }
    }

    onTestEvent(e: TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent): any {

        if (e.type === "started") {

            const items: TestAdapterItem[] = [];
            for (const test of e.tests) {
                const item = this.items.get(test);
                if (item) {
                    items.push(item);
                    this.setStateRec(item, vscode.TestRunState.Queued);
                    this.onDidChangeTestEmitter.fire(item);
                }
            }

            this.allRunningTests.set(e.testRunId, items);
            this.runningSuites.set(e.testRunId, [ this.root ]);

        } else if (e.type === "finished") {

            if (this.allRunningTests.has(e.testRunId)) {
                for (const item of this.allRunningTests.get(e.testRunId)!) {
                    this.setStateRec(item, vscode.TestRunState.Unset, vscode.TestRunState.Queued);
                }
                this.allRunningTests.delete(e.testRunId)
            }
            this.runningSuites.delete(e.testRunId);

        } else if (e.type === "suite") {

            const ancestors = this.runningSuites.get(e.testRunId);
            let item: TestAdapterItem | undefined;

            if (typeof e.suite === "string") {

                item = this.items.get(e.suite);
                if (item) {

                    const location = this.convertLocation(e) || item.location;
                    const messages = [ ...item.state.messages ];
                    if (e.message) {
                        messages.push({
                            message: e.message,
                            severity: vscode.TestMessageSeverity.Error,
                            location
                        });
                    }

                    item.description = e.description || item.description;
                    item.location = location;
                    item.state = new vscode.TestState(convertedStates[e.state], messages);

                    this.onDidChangeTestEmitter.fire(item);
                }

            } else {

                const parentItem = ancestors ? ancestors[ancestors.length - 1] : undefined;
                if (parentItem) {

                    item = this.convertTestSuite(e.suite);

                    if (!parentItem.children) {
                        parentItem.children = [];
                    }
                    parentItem.children.push(item);

                    this.onDidChangeTestEmitter.fire(parentItem);
                }
            }

            if (item && ancestors) {
                if (e.state === "running") {
                    ancestors.push(item);
                } else if (e.state === "completed") {
                    ancestors.pop();
                }
            }

        } else if (e.type === "test") {

            if (typeof e.test === "string") {

                const item = this.items.get(e.test);
                if (item) {

                    const messages = [ ...item.state.messages ];
                    if (e.message) {
                        messages.push({
                            message: e.message,
                            severity: vscode.TestMessageSeverity.Information
                        });
                    }
                    for (const decoration of e.decorations || []) {
                        messages.push({
                            message: decoration.message,
                            severity: vscode.TestMessageSeverity.Error,
                            location: this.convertLocation(decoration)
                        });
                    }

                    item.description = e.description || item.description;
                    item.location = this.convertLocation(e) || item.location;
                    item.state = new vscode.TestState(convertedStates[e.state], messages);

                    this.onDidChangeTestEmitter.fire(item);
                }

            } else {

                const ancestors = this.runningSuites.get(e.testRunId);
                const parentItem = ancestors ? ancestors[ancestors.length - 1] : undefined;
                if (parentItem) {

                    if (!parentItem.children) {
                        parentItem.children = [];
                    }
                    parentItem.children.push(this.convertTest(e.test));

                    this.onDidChangeTestEmitter.fire(parentItem);
                }
            }

        }

    }

    onRetireEvent(e: RetireEvent): any {
        if (!e.tests) return;

        for (const test of e.tests) {
            const item = this.items.get(test);
            if (item) {
                this.setStateRec(item, vscode.TestRunState.Unset);
                this.onDidChangeTestEmitter.fire(item);
            }
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private convertTests(items: (TestSuiteInfo | TestInfo)[]): TestAdapterItem[] {
        return items.map(child => (child.type === "suite") ? this.convertTestSuite(child) : this.convertTest(child));
    }
    
    private convertTestSuite(suite: TestSuiteInfo): TestAdapterItem {
    
        let runState: vscode.TestRunState = vscode.TestRunState.Unset;
        if (suite.errored) {
            runState = vscode.TestRunState.Errored;
        }
    
        const children = this.convertTests(suite.children);
    
        const item = {
            id: suite.id,
            label: suite.label,
            description: suite.description,
            location: this.convertLocation(suite),
            state: new vscode.TestState(runState),
            debuggable: !!this.adapter.debug && !!suite.debuggable,
            children
        }
        this.items.set(suite.id, item);
    
        return item;
    }
    
    private convertTest(test: TestInfo): TestAdapterItem {
    
        let runState: vscode.TestRunState = vscode.TestRunState.Unset;
        if (test.errored) {
            runState = vscode.TestRunState.Errored;
        } else if (test.skipped) {
            runState = vscode.TestRunState.Skipped;
        }
    
        const item = {
            id: test.id,
            label: test.label,
            description: test.description,
            location: this.convertLocation(test),
            state: new vscode.TestState(runState),
            debuggable: !!this.adapter.debug && !!test.debuggable
        }
        this.items.set(test.id, item);
    
        return item;
    }

    private convertLocation(info: { file?: string; line?: number }): vscode.Location | undefined {
        if (info.file && info.line) {
            return new vscode.Location(stringToUri(info.file), new vscode.Position(info.line, 0));
        }
        return undefined;
    }

    private setStateRec(item: TestAdapterItem, state: vscode.TestRunState, oldState?: vscode.TestRunState): void {
        if (!oldState || (item.state.runState === oldState)) {
            item.state = new vscode.TestState(state, [...item.state.messages], item.state.duration);
        }
        for (const child of item.children || []) {
            this.setStateRec(child, state, oldState);
        }
    }
}
