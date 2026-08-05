import i18n from "@/i18n";
import { routes } from "@/lib/routes";

/** Default product name used in document titles. */
export function getFallbackProductName(): string {
  return i18n.t("pageMeta.fallbackProductName");
}
/** Fallback page title when no route match is found. */
export function getFallbackPageTitle(): string {
  return i18n.t("pageMeta.fallbackPageTitle");
}

/** A pattern-based rule that maps a route regex to a page title key. */
interface RouteTitleRule {
  pattern: RegExp;
  titleKey: string;
}

/** Static mapping from route paths to i18n keys. */
const staticRouteTitleKeys = new Map<string, string>([
  [routes.login, "pageMeta.static.login"],
  [routes.admin.dashboard, "pageMeta.static.dashboard"],
  [routes.admin.users, "pageMeta.static.users"],
  [routes.admin.candidates, "pageMeta.static.candidates"],
  [routes.admin.settings, "pageMeta.static.settings"],
  [routes.admin.candidateFields, "pageMeta.static.candidateFields"],
  [routes.admin.courses, "pageMeta.static.courses"],
  [routes.admin.questions, "pageMeta.static.questions"],
  [routes.admin.questionsNew, "pageMeta.static.questionsNew"],
  [routes.admin.questionsImport, "pageMeta.static.questionsImport"],
  [routes.admin.exams, "pageMeta.static.exams"],
  [routes.admin.examsNew, "pageMeta.static.examsNew"],
  [routes.admin.proctorWorkspace, "pageMeta.static.proctorWorkspace"],
  [routes.admin.results, "pageMeta.static.results"],
  [routes.admin.system, "pageMeta.static.system"],
  [routes.admin.auditLogs, "pageMeta.static.auditLogs"],
  [routes.admin.importLogs, "pageMeta.static.importLogs"],
  [routes.admin.recovery, "pageMeta.static.recovery"],
  [routes.exam.list, "pageMeta.static.examList"],
]);

/** Regex-based title key rules for dynamic routes containing IDs. */
const dynamicRouteTitleKeys: RouteTitleRule[] = [
  {
    pattern: /^\/admin\/recovery\/incidents\/[^/]+$/,
    titleKey: "pageMeta.dynamic.recoveryIncident",
  },
  {
    pattern: /^\/admin\/recovery\/attempts\/[^/]+$/,
    titleKey: "pageMeta.dynamic.recoveryAttempt",
  },
  {
    pattern: /^\/admin\/recovery\/exams\/[^/]+$/,
    titleKey: "pageMeta.dynamic.recoveryExam",
  },
  {
    pattern: /^\/admin\/questions\/[^/]+\/edit$/,
    titleKey: "pageMeta.dynamic.questionEdit",
  },
  {
    pattern: /^\/admin\/exams\/[^/]+$/,
    titleKey: "pageMeta.dynamic.examDetail",
  },
  {
    pattern: /^\/admin\/exams\/[^/]+\/scores$/,
    titleKey: "pageMeta.dynamic.examScores",
  },
  {
    pattern: /^\/admin\/exams\/[^/]+\/proctor$/,
    titleKey: "pageMeta.dynamic.examProctor",
  },
  {
    pattern: /^\/admin\/exams\/[^/]+\/proctor\/monitor$/,
    titleKey: "pageMeta.dynamic.examMonitor",
  },
  {
    pattern: /^\/admin\/attempts\/[^/]+$/,
    titleKey: "pageMeta.dynamic.attemptDetail",
  },
  {
    pattern: /^\/exam\/[^/]+\/start$/,
    titleKey: "pageMeta.dynamic.examPrepare",
  },
  {
    pattern: /^\/exam\/[^/]+\/take$/,
    titleKey: "pageMeta.dynamic.examTake",
  },
  {
    pattern: /^\/exam\/[^/]+\/result$/,
    titleKey: "pageMeta.dynamic.examResult",
  },
];

/** Returns the page title for a given pathname, resolved dynamically via i18n. */
export function getPageTitle(pathname: string): string {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const staticKey = staticRouteTitleKeys.get(normalizedPathname);
  if (staticKey) return i18n.t(staticKey as never);
  const dynamicRule = dynamicRouteTitleKeys.find(({ pattern }) =>
    pattern.test(normalizedPathname),
  );
  if (dynamicRule) return i18n.t(dynamicRule.titleKey as never);
  return getFallbackPageTitle();
}

/** Returns the full document title in "PageTitle - ProductName" format. */
export function getDocumentTitle(
  pathname: string,
  productName: string,
): string {
  const pageTitle = getPageTitle(pathname);
  const safeProductName = productName.trim() || getFallbackProductName();
  return pageTitle === safeProductName
    ? safeProductName
    : `${pageTitle} - ${safeProductName}`;
}
