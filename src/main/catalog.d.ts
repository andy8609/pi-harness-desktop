import type { CatalogPackage } from "@shared/types";
type CatalogListener = (packages: CatalogPackage[]) => void;
export declare function setCatalogListener(next: CatalogListener | undefined): void;
export declare function catalogUpdatedAt(): number | undefined;
export declare function fetchPiPackages(force?: boolean): Promise<CatalogPackage[]>;
export {};
