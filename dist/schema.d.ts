type SchemaName = "route" | "session";
export declare function maxLengths(): Record<string, number>;
export declare function maxLength(key: string): number;
export declare function validate(data: unknown, name?: SchemaName): {
    valid: boolean;
    errors: string[];
};
export {};
