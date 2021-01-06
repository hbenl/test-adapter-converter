import * as vscode from "vscode";
import { TestAdapter, TestController } from "vscode-test-adapter-api";
import { TestAdapterProvider } from "./provider";

export class TestAdapterConverter implements TestController {

    private readonly disposables = new Map<TestAdapter, vscode.Disposable>();

    registerTestAdapter(adapter: TestAdapter): void {
        const disposable = vscode.test.registerTestProvider(new TestAdapterProvider(adapter));
        this.disposables.set(adapter, disposable);
    }

    unregisterTestAdapter(adapter: TestAdapter): void {
        const disposable = this.disposables.get(adapter);
        if (disposable) {
            disposable.dispose();
            this.disposables.delete(adapter);
        }
    }
}
