import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { cookies } from 'next/headers';
import { promises as fs } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { normalizeProblemSamples, type ProblemSample } from '@/lib/problem-samples';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'problems');

function getDataDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), 'data');
}

function getAssetsDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), 'assets');
}

interface ProblemData {
  id?: number;
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: { title: string; content: string }[];
  samples: ProblemSample[];
  hint?: string;
  judgeConfig?: string;
}

export async function POST(request: Request) {
  try {
    // 1. 身份验证
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyAuth(token);
    if (!payload.isGlobalAdmin) {
      return NextResponse.json({ error: 'Only admin can perform this action' }, { status: 403 });
    }

    // 2. 解析表单数据
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: 'Invalid file format' }, { status: 400 });
    }

    // 3. 读取ZIP文件
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const importedProblems: { id: number; title: string }[] = [];
    const errors: string[] = [];

    // 4. 遍历ZIP文件内容
    const zipEntries = Object.keys(zip.files);
    const problemDirs = new Set<string>();

    // 4.1 收集所有题目目录（只包含problem.json的目录）
    for (const entry of zipEntries) {
      if (entry.endsWith('/')) {
        const possibleProblemDir = entry;
        const problemJsonEntry = zip.files[`${possibleProblemDir}problem.json`];
        if (problemJsonEntry) {
          problemDirs.add(possibleProblemDir);
        }
      }
    }

    // 修复：对题目目录进行排序，确保按 ID 顺序导入
    const sortedProblemDirs = Array.from(problemDirs).sort((a, b) => {
      // 尝试提取数字 (e.g. "100/" -> 100)
      const numA = parseInt(a.replace(/\/$/, ""));
      const numB = parseInt(b.replace(/\/$/, ""));
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });

    // 4.2 处理每个题目目录
    for (const problemDir of sortedProblemDirs) {
      try {
        // 4.2.1 读取题目信息
        const problemJsonEntry = zip.files[`${problemDir}problem.json`];
        if (!problemJsonEntry) {
          continue;
        }

        const problemJsonContent = await problemJsonEntry.async('text');
        const problemData = JSON.parse(problemJsonContent) as ProblemData;

        // 4.2.2 验证题目数据
        if (!problemData.title || !problemData.type || !problemData.defaultTimeLimit || !problemData.defaultMemoryLimit) {
          errors.push(`Invalid problem data in ${problemDir}`);
          continue;
        }

        // 4.2.3 创建新题目（ID自增）
        let problem;
        const exportedId = (problemData as ProblemData).id;
        
        // 准备题目数据
        let sections = problemData.sections;
        let hint = problemData.hint;

        // 创建题目，让数据库生成新ID
        problem = await prisma.problem.create({
          data: {
            // 不指定id，使用自增
            title: problemData.title,
            type: problemData.type,
            defaultTimeLimit: problemData.defaultTimeLimit,
            defaultMemoryLimit: problemData.defaultMemoryLimit,
            sections: sections, // 暂时使用原始数据
            samples: normalizeProblemSamples(problemData.samples),
            hint: hint,
            judgeConfig: problemData.judgeConfig,
          },
        });

        // 如果存在导出ID，且新ID与旧ID不同（肯定不同或者是巧合），需要替换题面中的资源引用
        if (exportedId) {
          const oldIdStr = exportedId.toString();
          const newIdStr = problem.id.toString();

          let contentChanged = false;

          // 替换 sections 中的图片路径
          const sectionsStr = JSON.stringify(sections);
          if (sectionsStr.includes(`/api/problems/${oldIdStr}/`)) {
            const newSectionsStr = sectionsStr.replaceAll(`/api/problems/${oldIdStr}/`, `/api/problems/${newIdStr}/`);
            sections = JSON.parse(newSectionsStr);
            contentChanged = true;
          }

          // 替换 hint 中的图片路径
          if (hint && hint.includes(`/api/problems/${oldIdStr}/`)) {
            hint = hint.replaceAll(`/api/problems/${oldIdStr}/`, `/api/problems/${newIdStr}/`);
            contentChanged = true;
          }

          // 如果有内容变更，更新题目
          if (contentChanged) {
            problem = await prisma.problem.update({
              where: { id: problem.id },
              data: {
                sections,
                hint,
              },
            });
          }
        }

        importedProblems.push({ id: problem.id, title: problem.title });

        // 4.2.4 处理数据文件
        const dataDir = getDataDir(problem.id);
        await fs.mkdir(dataDir, { recursive: true });

        const dataEntries = zipEntries.filter(entry => 
          entry.startsWith(`${problemDir}data/`) && !entry.endsWith('/')
        );

        for (const dataEntry of dataEntries) {
          const entry = zip.files[dataEntry];
          if (!entry) continue;

          const content = await entry.async('nodebuffer');
          const fileName = path.basename(dataEntry);
          await fs.writeFile(path.join(dataDir, fileName), content);
        }

        // 4.2.5 处理附件
        const assetsDir = getAssetsDir(problem.id);
        await fs.mkdir(assetsDir, { recursive: true });

        const assetEntries = zipEntries.filter(entry => 
          entry.startsWith(`${problemDir}assets/`) && !entry.endsWith('/')
        );

        for (const assetEntry of assetEntries) {
          const entry = zip.files[assetEntry];
          if (!entry) continue;

          const content = await entry.async('nodebuffer');
          const fileName = path.basename(assetEntry);
          await fs.writeFile(path.join(assetsDir, fileName), content);
        }

      } catch (error) {
        errors.push(`Error processing ${problemDir}: ${(error as Error).message}`);
      }
    }

    // 5. 返回导入结果
    return NextResponse.json({
      success: true,
      importedProblems,
      errors,
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
