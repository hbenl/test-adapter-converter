import * as vscode from "vscode";
import { TestAdapter } from "vscode-test-adapter-api";
import { ConvertedTestHierarchy, TestAdapterItem } from "./hierarchy";

export class TestAdapterProvider implements vscode.TestProvider<TestAdapterItem> {

    private readonly hierarchies = new WeakMap<vscode.WorkspaceFolder, ConvertedTestHierarchy | undefined>();

    constructor(
        public readonly adapter: TestAdapter
    ) {}

    createWorkspaceTestHierarchy(workspaceFolder: vscode.WorkspaceFolder) {

        if (!this.hierarchies.has(workspaceFolder)) {

            let hierarchy: ConvertedTestHierarchy | undefined;
            if (workspaceFolder === this.adapter.workspaceFolder) {
                hierarchy = new ConvertedTestHierarchy(this.adapter);
            }

            this.hierarchies.set(workspaceFolder, hierarchy);
        }

        return this.hierarchies.get(workspaceFolder);
    }

    runTests(options: vscode.TestRunOptions<TestAdapterItem>, cancellationToken: vscode.CancellationToken): void {
        const testIds = options.tests.map(test => test.id);
        options.debug ? this.adapter.debug?.(testIds) : this.adapter.run(testIds);
        cancellationToken.onCancellationRequested(() => this.adapter.cancel());
    }
}
