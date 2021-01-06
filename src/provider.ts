import * as vscode from "vscode";
import { TestAdapter } from "vscode-test-adapter-api";
import { ConvertedTestHierarchy, DummyTestHierarchy, TestAdapterItem } from "./hierarchy";

export class TestAdapterProvider implements vscode.TestProvider<TestAdapterItem> {

    private readonly hierarchies = new WeakMap<vscode.WorkspaceFolder, vscode.TestHierarchy<TestAdapterItem>>();

    constructor(
        public readonly adapter: TestAdapter
    ) {}

    createWorkspaceTestHierarchy(workspaceFolder: vscode.WorkspaceFolder): vscode.TestHierarchy<TestAdapterItem> {

        if (!this.hierarchies.has(workspaceFolder)) {

            let hierarchy: vscode.TestHierarchy<TestAdapterItem>;
            if (workspaceFolder === this.adapter.workspaceFolder) {
                hierarchy = new ConvertedTestHierarchy(this.adapter);
            } else {
                hierarchy = new DummyTestHierarchy();
            }

            this.hierarchies.set(workspaceFolder, hierarchy);
        }

        return this.hierarchies.get(workspaceFolder)!;
    }

    runTests(options: vscode.TestRunOptions<TestAdapterItem>, cancellationToken: vscode.CancellationToken): void {
        const testIds = options.tests.map(test => test.id);
        options.debug ? this.adapter.debug?.(testIds) : this.adapter.run(testIds);
        cancellationToken.onCancellationRequested(() => this.adapter.cancel());
    }
}
