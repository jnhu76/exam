#!/bin/bash

# 运行 phase1.2 的测试检查

echo "Phase 1.2 测试检查："
echo "-------------------"

# 检查是否有未完成的任务文档
echo -e "\n1. 检查任务文档完整性："
expected_jobs=8
actual_jobs=$(ls -1 docs/phase1.2/docs/jobs/*.md | wc -l)

echo "预期任务文档数量：$expected_jobs"
echo "实际任务文档数量：$actual_jobs"

if [ "$actual_jobs" -eq "$expected_jobs" ]; then
  echo "✅ 任务文档数量完整"
else
  echo "❌ 任务文档数量不完整"
  echo "缺失的任务文档："
  for i in $(seq 1 $expected_jobs); do
    if [ ! -f "docs/phase1.2/docs/jobs/phase1.2_job0${i}_*.md" ]; then
      echo "  - phase1.2_job0${i}_*.md"
    fi
  done
fi

# 检查文档格式
echo -e "\n2. 检查文档格式："
markdown_lint=$(npm run lint:markdown -- docs/phase1.2/ 2>&1 || true)

if [ $? -eq 0 ]; then
  echo "✅ 文档格式符合要求"
else
  echo "❌ 文档格式不符合要求"
  echo "$markdown_lint"
fi

# 检查是否有重复内容
echo -e "\n3. 检查重复内容："
duplicate_lines=$(grep -r "TODO" docs/phase1.2/ 2>/dev/null)

if [ -z "$duplicate_lines" ]; then
  echo "✅ 未发现重复内容"
else
  echo "❌ 发现重复内容："
  echo "$duplicate_lines"
fi

# 检查文档链接
echo -e "\n4. 检查文档链接："
broken_links=$(linkchecker docs/phase1.2/ 2>&1 || true)

if [ $? -eq 0 ]; then
  echo "✅ 所有链接都是有效的"
else
  echo "❌ 发现无效链接"
  echo "$broken_links"
fi

# 总结
echo -e "\n总结："
if [ "$actual_jobs" -eq "$expected_jobs" ] && [ $? -eq 0 ]; then
  echo "✅ 所有检查都通过"
else
  echo "❌ 有检查未通过"
fi
