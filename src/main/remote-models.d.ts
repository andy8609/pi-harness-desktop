export interface RemoteModelOption {
    id: string;
    name?: string;
}
export declare function listRemoteModels(baseUrl: string, apiKey?: string): Promise<RemoteModelOption[]>;
