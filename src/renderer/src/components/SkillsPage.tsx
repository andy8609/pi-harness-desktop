import { PackagePage } from "./PackagePage";

/**
 * Skills 页：薄包装，全部行为由 `PackagePage` 承载（审计 S3-1）。
 * 导入本地文件/目录是本页独有的页头操作，通过 quickActions 走与安装/卸载一致的资源重载流程。
 */
export function SkillsPage() {
  return (
    <PackagePage
      kind="skill"
      title="Skills"
      description="Skills 从 npm 安装到 ~/.pi/agent，也可导入本地 SKILL.md 或技能目录。启用状态对当前会话生效。"
      searchPlaceholder="搜索 Skills"
      quickActions={[
        {
          label: "导入 SKILL.md",
          action: () => window.pi.importSkillFile(),
          success: "已导入本地 Skill 文件",
        },
        {
          label: "导入目录",
          action: () => window.pi.importSkillDir(),
          success: "已导入本地 Skill 目录",
        },
      ]}
    />
  );
}
