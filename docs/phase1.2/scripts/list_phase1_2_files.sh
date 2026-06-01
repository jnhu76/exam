#!/bin/bash

# 列出 phase1.2 文档文件

echo "Phase 1.2 文档文件列表："
echo "------------------------"

echo "主目录文件："
ls -la docs/phase1.2/

echo -e "\n文档目录："
ls -la docs/phase1.2/docs/

echo -e "\n任务文档："
ls -la docs/phase1.2/docs/jobs/

echo -e "\n提示文件："
ls -la docs/phase1.2/docs/prompts/

echo -e "\n脚本目录："
ls -la docs/phase1.2/scripts/

echo -e "\n总文件数量："
find docs/phase1.2/ -type f | wc -l
