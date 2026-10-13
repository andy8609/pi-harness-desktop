import type { FileContent, FileEntry } from "@shared/types";
/**
 * Resolve a user-supplied path against `cwd`, refusing anything that escapes it.
 * The work panel must never be able to read arbitrary files on disk.
 */
export declare function resolveInsideRoot(cwd: string, relPath: string): string;
export declare function listDirectory(cwd: string, relPath?: string): FileEntry[];
export declare function readFileText(cwd: string, relPath: string): FileContent;
