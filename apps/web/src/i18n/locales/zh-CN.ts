/**
 * zh-CN translation catalog (the only supported locale in Phase 2).
 *
 * Keys are organized by domain. Status labels mirror `statusMeta` /
 * `constants` 1:1 so the UI layer can render them via `t()` while the
 * status *enum* and *tone/icon* metadata stay in `statusMeta.ts` (which now
 * stores `labelKey` instead of a hardcoded Chinese string).
 *
 * Keep keys stable and grouped; do NOT delete a key without grepping usages.
 */

const zhCN = {
  status: {
    exam: {
      draft: "草稿",
      published: "已发布",
      open: "开放中",
      closed: "已关闭",
      archived: "已归档",
    },
    enrollment: {
      assigned: "已分配",
      started: "已开始",
      completed: "已完成",
      blocked: "已阻止",
      not_started: "未开始",
    },
    attempt: {
      queued: "排队中",
      in_progress: "答题中",
      disrupted: "断线",
      submitted: "已交卷",
      grading: "批改中",
      graded: "已出分",
      voided: "已作废",
    },
    save: {
      saving: "保存中",
      saved: "已保存",
      failed: "保存失败",
    },
    lifecycle: {
      canceled: "已取消",
      expired: "已过期",
      stale: "过期数据",
    },
    connection: {
      connected: "连接正常",
      degraded: "连接不稳定",
      offline: "连接已断开",
    },
    health: {
      ok: "正常",
      critical: "严重",
      unknown: "未知",
    },
    result: {
      passed: "及格",
      not_passed: "不及格",
    },
    grading: {
      auto_graded: "自动评分",
      pending_manual: "待手动评分",
      fully_graded: "已完成评分",
    },
    misconduct: {
      misconduct_warning: "违规-警告",
      misconduct_serious: "违规-严重",
    },
    fallback: {
      unknown: "未知",
    },
  },

  /**
   * Candidate exam-list availability labels (CandidateExamSummary).
   * Distinct from the attempt/exam/enrollment status grammar above — these
   * are the candidate-facing availability buckets shown on the exam list.
   */
  availability: {
    available: "可参加",
    in_progress: "进行中",
    resumable: "可恢复",
    submitted_pending_grade: "待评分",
    graded: "已评分",
    max_attempts_exhausted: "次数已用完",
    not_started_yet: "未开放",
    expired: "已过期",
    unavailable: "不可用",
  },

  questionType: {
    single_choice: "单选",
    multiple_choice: "多选",
    fill_blank: "填空",
    true_false: "判断",
  },

  /**
   * Global error / toast / notify messages. API error *codes* stay machine
   * semantic (contracts/messageRegistry); these are the generic UI-facing
   * fallbacks and common mutation success/failure toasts.
   */
  errors: {
    network: "网络连接失败，请稍后重试",
    unauthorized: "登录已过期，请重新登录",
    forbidden: "没有权限执行此操作",
    notFound: "资源不存在或已被删除",
    validation: "输入内容有误，请检查后重试",
    unknown: "操作失败，请稍后重试",
    operationFailed: "操作失败，请重试",
  },

  toast: {
    saved: "已保存",
    saveFailed: "保存失败",
    submitted: "已提交",
    submitFailed: "提交失败",
    deleted: "已删除",
    deleteFailed: "删除失败",
    updated: "已更新",
    updateFailed: "更新失败",
    created: "已创建",
    createFailed: "创建失败",
  },

  common: {
    retry: "重试",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    save: "保存",
    submit: "提交",
    loading: "加载中…",
    empty: "暂无数据",
  },

  /** AppSidebar / navigation labels. Mirrors the sidebar structure 1:1. */
  nav: {
    groups: {
      overview: "概览",
      questionBank: "题库",
      exams: "考试",
      management: "管理",
    },
    items: {
      dashboard: "仪表盘",
      courses: "课程管理",
      questions: "题目管理",
      questionsImport: "题目导入",
      exams: "考试管理",
      gradingQueue: "待评分",
      results: "成绩查询",
      users: "用户管理",
      candidates: "考生管理",
      importLogs: "导入日志",
      auditLogs: "审计日志",
      settings: "平台设置",
      candidateFields: "考生字段",
      system: "系统监控",
    },
    actions: {
      collapse: "折叠侧栏",
      expand: "展开侧栏",
      logout: "退出登录",
      logoutShort: "退出",
    },
  },

  /** ExamListPage (candidate-facing exam list) copy. */
  examList: {
    actions: {
      start: "开始考试",
      resume: "继续考试",
      viewResult: "查看成绩",
      viewHistory: "查看记录",
    },
    /** Card metadata with interpolation. i18next interpolation: {{value}}. */
    meta: {
      duration: "{{minutes}}分钟",
      passingScore: "及格分: {{score}}/{{total}}",
      questionCount: "题目数: {{count}}",
      attempts: "已考: {{used}}/{{max}}次",
    },
    sections: {
      canTake: "可参加的考试",
      history: "历史考试",
      upcoming: "即将开始",
    },
    empty: {
      title: "暂无可参加的考试",
      description: "当前没有可用的考试。",
    },
    errors: {
      loadFailed: "加载考试列表失败",
    },
  },

  /** SystemDiagnosticsPage (admin diagnostics) copy. */
  diagnostics: {
    title: "系统监控",
    actions: {
      refresh: "刷新系统数据",
    },
    header: {
      lastRefreshed: "上次刷新：{{time}}",
    },
    errors: {
      healthLoadFailed: "加载系统健康数据失败",
      diagnosticsLoadFailed: "加载诊断数据失败",
    },
    staleWarnings: {
      health: "系统状态刷新失败，当前显示上次成功数据",
      diagnostics: "诊断数据刷新失败，当前显示上次成功数据",
    },
    metrics: {
      cpuUsage: "CPU 使用率",
      memoryUsage: "内存使用率",
      dbResponseTime: "数据库响应时间",
    },
    cards: {
      serverInfo: "服务器信息",
      databaseStatus: "数据库状态",
      runtimeConfig: "运行时配置",
      heartbeatScanner: "心跳扫描器",
      deadlineScanner: "截止扫描器",
    },
    labels: {
      version: "版本",
      uptime: "运行时间",
      latency: "延迟",
      redis: "Redis",
      redisConnected: "已连接 ({{latencyMs}}ms)",
      redisDisconnected: "未连接",
      heartbeatInterval: "心跳间隔",
      heartbeatTimeout: "心跳超时",
      deadlineScanInterval: "截止扫描间隔",
      scanInterval: "扫描间隔",
      timeout: "超时",
      lastScan: "上次扫描",
      disruptedCount: "已中断",
      autoSubmitCount: "自动提交",
      lastScanNever: "无",
    },
  },
} as const;

export default zhCN;
