import type { ModelsFile } from "@shared/types";
export declare function readModelsFile(path: string): {
    file: ModelsFile;
    raw: string;
    error?: string;
};
export declare function writeModelsFile(path: string, file: ModelsFile): void;
