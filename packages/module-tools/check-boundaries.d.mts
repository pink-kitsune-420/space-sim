export function checkSource(source: string, path: string): string[];
export function checkBoundaries(): Promise<number>;
export function reachable(entry: string): Promise<Set<string>>;
