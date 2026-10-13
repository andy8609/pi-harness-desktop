export interface DesktopPrefs {
    lastCwd?: string;
    windowBounds?: {
        x?: number;
        y?: number;
        width: number;
        height: number;
    };
}
export declare function loadPrefs(): DesktopPrefs;
export declare function savePrefs(patch: Partial<DesktopPrefs>): DesktopPrefs;
export declare function prefsExist(): boolean;
