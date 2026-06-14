import { routes } from "@/lib/routes";

export const fallbackProductName = "考试平台";
export const fallbackPageTitle = "页面";

interface RouteTitleRule {
  pattern: RegExp;
  title: string;
}

const staticRouteTitles = new Map<string, string>([
  [routes.login, "登录"],
  [routes.admin.dashboard, "仪表盘"],
  [routes.admin.users, "用户管理"],
  [routes.admin.candidates, "考生管理"],
  [routes.admin.settings, "平台设置"],
  [routes.admin.candidateFields, "考生字段"],
  [routes.admin.courses, "课程管理"],
  [routes.admin.questions, "题目管理"],
  [routes.admin.questionsNew, "新建题目"],
  [routes.admin.questionsImport, "题目导入"],
  [routes.admin.exams, "考试管理"],
  [routes.admin.examsNew, "新建考试"],
  [routes.admin.results, "成绩查询"],
  [routes.admin.system, "系统健康"],
  [routes.exam.list, "我的考试"],
]);

const dynamicRouteTitles: RouteTitleRule[] = [
  { pattern: /^\/admin\/questions\/[^/]+\/edit$/, title: "编辑题目" },
  { pattern: /^\/admin\/exams\/[^/]+$/, title: "考试详情" },
  { pattern: /^\/admin\/exams\/[^/]+\/scores$/, title: "成绩列表" },
  { pattern: /^\/admin\/attempts\/[^/]+$/, title: "答题详情" },
  { pattern: /^\/exam\/[^/]+\/start$/, title: "考试准备" },
  { pattern: /^\/exam\/[^/]+\/take$/, title: "正在答题" },
  { pattern: /^\/exam\/[^/]+\/result$/, title: "考试结果" },
];

export function getPageTitle(pathname: string): string {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const staticTitle = staticRouteTitles.get(normalizedPathname);
  if (staticTitle) return staticTitle;
  return (
    dynamicRouteTitles.find(({ pattern }) => pattern.test(normalizedPathname))
      ?.title ?? fallbackPageTitle
  );
}

export function getDocumentTitle(
  pathname: string,
  productName: string,
): string {
  const pageTitle = getPageTitle(pathname);
  const safeProductName = productName.trim() || fallbackProductName;
  return pageTitle === safeProductName
    ? safeProductName
    : `${pageTitle} - ${safeProductName}`;
}
