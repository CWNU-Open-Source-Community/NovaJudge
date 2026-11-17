import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedGlobalUser } from '@/lib/auth';
import { cookies } from 'next/headers';
import { promises as fs } from 'fs';
import path from 'path';
import JSZip from 'jszip';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'problems');

function getDataDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), 'data');
}

function getAssetsDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), 'assets');
}

export async function POST(request: Request) {
  try {
    // 1. 身份验证
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await getVerifiedGlobalUser(token);
    if (!payload?.isGlobalAdmin) {
      return NextResponse.json({ error: 'Only admin can perform this action' }, { status: 403 });
    }

    // 2. 解析请求参数
    const body = await request.json();
    const { problemIds } = body;

    if (!Array.isArray(problemIds) || problemIds.length === 0) {
      return NextResponse.json({ error: 'Invalid problemIds' }, { status: 400 });
    }

    // 3. 创建ZIP文件
    const zip = new JSZip();

    // 4. 处理每个题目
    for (const problemId of problemIds) {
      // 4.1 获取题目信息
      const problem = await prisma.problem.findUnique({
        where: { id: problemId },
      });

      if (!problem) {
        continue;
      }

      const problemDir = zip.folder(`problem_${problemId}_${problem.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}`);
      if (!problemDir) continue;

      // 4.2 导出题目基本信息
      problemDir.file('problem.json', JSON.stringify({
        id: problem.id,
        title: problem.title,
        type: problem.type,
        defaultTimeLimit: problem.defaultTimeLimit,
        defaultMemoryLimit: problem.defaultMemoryLimit,
        sections: problem.sections,
        samples: problem.samples,
        hint: problem.hint,
        judgeConfig: problem.judgeConfig,
      }, null, 2));

      // 4.3 导出数据文件（评测点等）
      const dataDir = getDataDir(problemId);
      try {
        await fs.access(dataDir);
        const dataFiles = await fs.readdir(dataDir);
        const dataFolder = problemDir.folder('data');
        if (dataFolder) {
          for (const file of dataFiles) {
            const filePath = path.join(dataDir, file);
            const content = await fs.readFile(filePath);
            dataFolder.file(file, content);
          }
        }
      } catch (error) {
        console.error(`Error reading data directory for problem ${problemId}:`, error);
      }

      // 4.4 导出附件
      const assetsDir = getAssetsDir(problemId);
      try {
        await fs.access(assetsDir);
        const assetFiles = await fs.readdir(assetsDir);
        const assetsFolder = problemDir.folder('assets');
        if (assetsFolder) {
          for (const file of assetFiles) {
            const filePath = path.join(assetsDir, file);
            const content = await fs.readFile(filePath);
            assetsFolder.file(file, content);
          }
        }
      } catch (error) {
        console.error(`Error reading assets directory for problem ${problemId}:`, error);
      }
    }

    // 5. 生成ZIP文件
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 6. 返回ZIP文件
    return new Response(zipBuffer as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="problems_${Date.now()}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
