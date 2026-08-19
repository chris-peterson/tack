export declare function maxLengths(): Record<string, number>;
export declare function maxLength(key: string): number;
export declare function validate(data: unknown): {
    valid: boolean;
    errors: string[];
};
