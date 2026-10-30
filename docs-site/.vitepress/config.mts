import { defineConfig } from "vitepress";
import { PRODUCT_SHA, PRODUCT_SHA_SHORT } from "../shared/version.mjs";
import { statusLabelsPlugin } from "./status-labels";

/**
 * CJK-aware tokenizer for VitePress local search.
 *
 * PROTOCOL: VitePress serializes themeConfig functions with
 * Function.prototype.toString and reconstructs them on the client, so this
 * function must stay self-contained (no module-scope constants or helpers).
 *
 * Latin text keeps word tokens; CJK runs emit unigrams and bigrams, because a
 * whitespace tokenizer would index a whole unspaced Chinese sentence as one
 * term and make Chinese search unusable.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const parts = text.split(/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)/u);
  for (const part of parts) {
    if (!part) continue;
    if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/u.test(part)) {
      const chars = Array.from(part);
      for (const char of chars) tokens.push(char);
      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.push(chars[index] + chars[index + 1]);
      }
    } else {
      for (const token of part.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (token) tokens.push(token);
      }
    }
  }
  return tokens;
}

const enNav = [
  { text: "Overview", link: "/overview" },
  { text: "Quick start", link: "/guide/first-exam" },
  { text: "Standard support", link: "/standard/capabilities" },
  { text: "Reliability", link: "/reliability" },
  { text: "Developer", link: "/developer" },
  { text: "FAQ", link: "/faq" },
];

const zhNav = [
  { text: "概览", link: "/zh/overview" },
  { text: "快速开始", link: "/zh/guide/first-exam" },
  { text: "标准支持", link: "/zh/standard/capabilities" },
  { text: "可靠性", link: "/zh/reliability" },
  { text: "开发者", link: "/zh/developer" },
  { text: "常见问题", link: "/zh/faq" },
];

const enSidebar = [
  {
    text: "Get started",
    items: [
      { text: "Overview", link: "/overview" },
      { text: "First exam walkthrough", link: "/guide/first-exam" },
    ],
  },
  {
    text: "Product reference",
    items: [
      {
        text: "Standard capabilities & limits",
        link: "/standard/capabilities",
      },
      { text: "Exam configuration", link: "/configure/exam-configuration" },
    ],
  },
  {
    text: "Operations",
    items: [
      { text: "Reliability & operations", link: "/reliability" },
      { text: "FAQ & troubleshooting", link: "/faq" },
    ],
  },
  {
    text: "Repository",
    items: [{ text: "Developer & architecture", link: "/developer" }],
  },
];

const zhSidebar = [
  {
    text: "开始使用",
    items: [
      { text: "概览", link: "/zh/overview" },
      { text: "首场考试指南", link: "/zh/guide/first-exam" },
    ],
  },
  {
    text: "产品参考",
    items: [
      { text: "Standard 能力与限制", link: "/zh/standard/capabilities" },
      { text: "考试配置", link: "/zh/configure/exam-configuration" },
    ],
  },
  {
    text: "运维",
    items: [
      { text: "可靠性与运维", link: "/zh/reliability" },
      { text: "常见问题", link: "/zh/faq" },
    ],
  },
  {
    text: "仓库",
    items: [{ text: "开发者与架构", link: "/zh/developer" }],
  },
];

const searchLocales = {
  zh: {
    translations: {
      button: {
        buttonText: "搜索文档",
        buttonAriaLabel: "搜索文档",
      },
      modal: {
        displayDetails: "显示详细列表",
        resetButtonTitle: "重置搜索",
        backButtonTitle: "关闭搜索",
        noResultsText: "没有找到结果：",
        footer: {
          selectText: "选择",
          selectKeyAriaLabel: "回车",
          navigateText: "切换",
          navigateUpKeyAriaLabel: "上箭头",
          navigateDownKeyAriaLabel: "下箭头",
          closeText: "关闭",
          closeKeyAriaLabel: "Esc",
        },
      },
    },
  },
};

export default defineConfig({
  title: "Exam Documentation",
  description:
    "LAN and on-premise exam and assessment documentation for one institution. A development snapshot, not the published v0.0.10 contract.",
  lang: "en",
  srcDir: "./content",
  cleanUrls: true,
  lastUpdated: false,
  head: [
    ["meta", { name: "robots", content: "noindex, nofollow" }],
    ["meta", { name: "exam-docs-product-sha", content: PRODUCT_SHA }],
  ],
  markdown: {
    config(md) {
      statusLabelsPlugin(md);
    },
  },
  themeConfig: {
    nav: enNav,
    sidebar: {
      "/": enSidebar,
      "/zh/": zhSidebar,
    },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
    darkModeSwitchLabel: "Appearance",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Return to top",
    langMenuLabel: "Change language",
    notFound: {
      title: "Page not found",
      quote:
        "This route does not exist in the documentation pilot. Use the navigation to find a published page.",
      linkLabel: "go to home",
      linkText: "Take me home",
    },
    footer: {
      message:
        "Repo-only documentation pilot. Product facts are projections of reviewed repository documents; no publication or hosting is configured.",
      copyright: `Development snapshot bound to master ${PRODUCT_SHA_SHORT}.`,
    },
    search: {
      provider: "local",
      options: {
        miniSearch: {
          options: { tokenize },
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: { title: 4, text: 3, titles: 2 },
          },
        },
        locales: searchLocales,
      },
    },
  },
  locales: {
    root: { label: "English", lang: "en" },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      title: "Exam 文档",
      description:
        "面向单一机构的局域网 / 本地部署考试与测评文档。开发版本快照，不等同于已发布的 v0.0.10 契约。",
      // VitePress merges this locale-specific themeConfig over the root one
      // for every /zh/ page (site data, not themeConfig.locales).
      themeConfig: {
        navTitle: "Exam 文档",
        nav: zhNav,
        outline: { level: [2, 3], label: "本页目录" },
        docFooter: { prev: "上一页", next: "下一页" },
        darkModeSwitchLabel: "外观",
        sidebarMenuLabel: "菜单",
        returnToTopLabel: "回到顶部",
        langMenuLabel: "切换语言",
        notFound: {
          title: "页面不存在",
          quote: "该路由不在文档试点范围内。请使用导航访问已发布的页面。",
          linkLabel: "返回首页",
          linkText: "回到首页",
        },
        footer: {
          message:
            "Repo-only 文档试点。产品事实均为已评审仓库文档的投影；未配置公开发布或托管。",
          copyright: `开发版本快照，绑定 master ${PRODUCT_SHA_SHORT}。`,
        },
      },
    },
  },
});
