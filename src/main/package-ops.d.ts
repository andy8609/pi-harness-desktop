import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { InstalledResource, PackageInventory } from "@shared/types";
export interface PackageContext {
    cwd: string;
    agentDir: string;
    settingsManager: SettingsManager;
    pm: DefaultPackageManager;
}
export declare function createPackageContext(cwd: string, existing?: SettingsManager): PackageContext;
export declare function listInstalled(ctx: PackageContext): Promise<PackageInventory>;
export declare function toggleResource(ctx: PackageContext, item: InstalledResource, enabled: boolean): void;
export declare function importLocalSkill(sourcePath: string): string;
export declare function toNpmSource(name: string): string;
