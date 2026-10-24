import { PackagePage } from "./PackagePage";

/**
 * 扩展页：薄包装，全部行为由 `PackagePage` 承载（审计 S3-1）。
 * 说明文案只保留用户需要知道的结论，实现细节（npm 关键字、分页）不再占用页头。
 */
export function ExtensionsPage() {
  return (
    <PackagePage
      kind="extension"
      title="扩展"
      description="扩展从 npm 安装到 ~/.pi/agent，与 CLI 的 pi install 一致。启用状态对当前会话生效。"
      searchPlaceholder="搜索扩展"
    />
  );
}
