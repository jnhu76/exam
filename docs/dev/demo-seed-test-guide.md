# Demo Seed Test Guide

## Commands

```bash
# Fresh demo seed (deletes and recreates dev.db, seeds + verifies)
rm -f dev.db && pnpm db:seed:demo

# Re-run on existing database (idempotent)
pnpm db:seed:demo

# Verify only (re-seeds then verifies)
pnpm db:seed:demo:verify

# Start development servers
pnpm dev
```

## Demo Accounts

| Username | Password | Role | Login Destination |
|---|---|---|---|
| superadmin | admin123 | SuperAdmin | /admin/dashboard |
| admin | admin123 | Admin | /admin/dashboard |
| teacher1 | teacher123 | Teacher | /admin/dashboard |
| teacher2 | teacher123 | Teacher | /admin/dashboard |
| candidate1 | candidate123 | Candidate | /exam/list |
| candidate2 | candidate123 | Candidate | /exam/list |
| candidate3 | candidate123 | Candidate | /exam/list |
| candidate4 | candidate123 | Candidate | /exam/list |

## Test Flows by Account

### superadmin / admin

1. **Dashboard**: Should show total questions (10), active exams (2), total candidates (4)
2. **Organizations** (superadmin only): Should list "Demo Organization"
3. **Users**: Should show 4 admin/teacher users (Candidate users hidden)
4. **Candidates**: Should show 4 candidates with employeeId, department, phone columns
5. **Candidate Fields**: Should show 3 fields (工号, 部门, 手机号)
6. **Courses**: Should show 3 courses (SAFETY-101, SKILL-201, EMPTY-001)
7. **Questions**: Should show 10 questions, filterable by type/course/difficulty
8. **Exams**: Should show 5 exams in different statuses (open, draft, published, closed, open)
9. **Exam Detail (open exam)**: Should show 4 enrolled candidates with different states
10. **Results Overview**: Should show closed and published exams
11. **Score List (closed exam)**: Should show 4 graded attempts with stats
12. **Attempt Detail**: Should show per-question grading results
13. **Settings**: Should show branding settings (Exam Platform, Demo Organization)
14. **System Health**: Should show ok status with metrics

### teacher1 / teacher2

1. **Dashboard**: Same as admin but no "Management" sidebar section
2. **Courses**: Full CRUD
3. **Questions**: Full CRUD + import
4. **Exams**: Full CRUD + publish + archive
5. **Exam Detail**: View and manage enrollments
6. **Score List**: View all scores
7. **No access to**: Users, Candidates, Candidate Fields, Settings, Organizations

### candidate1 (in-progress exam)

1. **Login** → redirected to `/exam/list`
2. **Exam List**: Should see "安全培训考核 A" as available, with attempt count 1/2
3. **Start Exam**: Should resume the existing in-progress attempt (not start new)
4. **Take Exam**: Should show 6 questions, 2 already answered, timer running

### candidate2 (assigned, not started)

1. **Login** → redirected to `/exam/list`
2. **Exam List**: Should see "安全培训考核 A" as available, attempt count 0/2
3. **Start Exam**: Should start a new attempt
4. **Take Exam**: Full 6-question exam, can answer and submit

### candidate3 (disrupted)

1. **Login** → redirected to `/exam/list`
2. **Exam List**: Should see "安全培训考核 A" as available
3. **Start Exam**: Should attempt to restore the disrupted attempt
4. **Recovery**: Attempt should transition from disrupted → in_progress

### candidate4 (graded result)

1. **Login** → redirected to `/exam/list`
2. **Exam List**: Should see "安全培训考核 A" as available, with final score displayed
3. **View Result**: Should show graded result with per-question details

## Exam Data Matrix

### For Candidate Users

| Exam | candidate1 | candidate2 | candidate3 | candidate4 |
|---|---|---|---|---|
| 安全培训考核 A (open) | in_progress | can start | disrupted | graded |
| 安全培训草稿考试 (draft) | not visible | not visible | not visible | not visible |
| 安全培训已发布未开始 (published, future) | visible, not yet available | visible, not yet available | visible, not yet available | visible, not yet available |
| 技能认证历史考试 (closed) | 2 graded attempts | 1 failed attempt | 1 borderline attempt | 1 full-score attempt |
| 严格模式考试 (open) | enrolled, can start | not enrolled | not enrolled | not enrolled |

## What to Verify

### Data Chain Integrity

- [ ] Login works for all 8 accounts
- [ ] Dashboard shows non-zero stats
- [ ] Course list shows 3 courses
- [ ] Question list shows 10 questions with all 4 types
- [ ] Question filter by type works
- [ ] Question filter by course works
- [ ] Empty course (EMPTY-001) shows 0 questions
- [ ] Exam list shows 5 exams
- [ ] Draft exam cannot be started by candidates
- [ ] Published future exam shows as "not yet available"
- [ ] Open exam is available for enrolled candidates
- [ ] Closed exam shows in results overview
- [ ] Score list shows stats (average, max, min, pass rate)

### Candidate Flows

- [ ] candidate1 can resume in-progress attempt
- [ ] candidate2 can start a new attempt
- [ ] candidate3 can restore disrupted attempt
- [ ] candidate4 can view graded result
- [ ] Answer save works (version increments)
- [ ] Timer counts down (cosmetic)
- [ ] Submit triggers grading
- [ ] Result shows per-question details

### Admin Flows

- [ ] Can create new course
- [ ] Can create new question (all 4 types)
- [ ] Can create draft exam
- [ ] Can publish draft exam (snapshot generated)
- [ ] Can add candidates to exam
- [ ] Can remove assigned enrollment
- [ ] Can archive published/closed exam

## Known Gaps

1. **Proctor role**: Defined but has zero route access. No pages to test.
2. **Queue entry**: `requireQueue` flag exists but queue is in-memory only (not persisted). Restarting server clears queue state.
3. **Voided attempts**: Status declared but no implementation in Phase 1.
4. **daily_limit/weekly_limit retake**: Declared but never enforced.
5. **participantCount**: Dashboard recent exams always show 0 for participant count.
6. **Multi-tenant isolation**: Tenant guard is a stub. Demo only has one organization.
