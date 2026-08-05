export declare const SERVICE_LABEL = "com.chris-peterson.tack.serve";
export type Supervisor = "launchd" | "systemd" | "none";
export declare function wrapperPath(): string;
export declare function supervisor(): Supervisor;
export declare function renderPlist(wrapper: string, port: number, log: string, errLog: string): string;
export declare function renderUnit(wrapper: string, port: number): string;
export declare function install(port: number): void;
export declare function uninstall(): void;
export declare function status(port: number): void;
