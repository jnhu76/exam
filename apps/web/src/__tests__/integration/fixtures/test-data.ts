export const mockUsers = {
  admin: {
    username: "admin",
    password: "password",
    name: "管理员",
    role: "Admin",
  },
  candidate: {
    username: "candidate",
    password: "password",
    name: "考生",
    role: "Candidate",
  },
};

export const mockExams = {
  draftExam: {
    title: "草稿考试",
    description: "草稿考试描述",
    durationMinutes: 60,
    passingScore: 60,
    totalScore: 100,
  },
  publishedExam: {
    title: "已发布考试",
    description: "已发布考试描述",
    durationMinutes: 90,
    passingScore: 70,
    totalScore: 100,
  },
};

export const mockCandidates = {
  candidate1: {
    name: "张三",
    fields: { candidateId: "C001", department: "计算机" },
  },
  candidate2: {
    name: "李四",
    fields: { candidateId: "C002", department: "理科" },
  },
};
