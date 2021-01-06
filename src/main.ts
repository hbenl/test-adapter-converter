import * as vscode from "vscode";
import { testExplorerExtensionId, TestHub } from "vscode-test-adapter-api";
import { TestAdapterConverter } from "./converter";

let testHub: TestHub;
let converter: TestAdapterConverter;

export async function activate(context: vscode.ExtensionContext) {

    const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);

    if (testExplorerExtension) {

        testHub = testExplorerExtension.exports;
        converter = new TestAdapterConverter();
        testHub.registerTestController(converter);

    }
}

export function deactivate(): void {
    if (testHub && converter) {
        testHub.unregisterTestController(converter);
    }
}
