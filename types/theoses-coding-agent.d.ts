// Minimal CI type shim for "theoses-coding-agent". The real contract is the
// runtime API in H4fizWasabie/theoses2 (packages/coding-agent/src); this shim
// exists so extension CI can typecheck without building the whole engine.
declare module "theoses-coding-agent" {
	export interface ExtensionContext {
		cwd?: string;
		sessionManager?: {
			getSessionId(): string;
			getEntries(): unknown[];
			[key: string]: any;
		};
		[key: string]: any;
	}
	export interface ExtensionAPI {
		registerTool(tool: unknown): void;
		on(event: string, handler: (...args: any[]) => void): void;
		[key: string]: any;
	}
}
