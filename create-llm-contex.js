const fs = require('fs').promises;
const path = require('path');
const ignore = require('ignore');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// Configuration object
const config = {
  excludedDirs: [
    'node_modules',
    '.git',
    'dist',
    'build',
    'logs',
    'supabase',
    'coverage'
  ],
  includedExtensions: [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.php',
    '.py',
    '.java',
    '.sql',
    '.prisma',
    '.env.example'
  ],
  outputFile: 'codebase_context.json'
};

// Map file extensions to human-friendly language names
const languageMapping = {
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.php': 'PHP',
  '.py': 'Python',
  '.java': 'Java',
  '.sql': 'SQL',
  '.prisma': 'Prisma',
  '.env.example': 'Environment Configuration'
};

async function getGitInfo() {
  try {
    const { stdout: remoteUrl } = await exec('git config --get remote.origin.url');
    const { stdout: branch } = await exec('git rev-parse --abbrev-ref HEAD');
    const { stdout: lastCommit } = await exec('git log -1 --format=%H');
    
    return {
      repository: remoteUrl.trim(),
      branch: branch.trim(),
      lastCommit: lastCommit.trim()
    };
  } catch (error) {
    return { error: 'Not a git repository or git not installed' };
  }
}

async function getDependencies() {
  try {
    const packageJson = await fs.readFile('package.json', 'utf8');
    const { dependencies = {}, devDependencies = {} } = JSON.parse(packageJson);
    return { dependencies, devDependencies };
  } catch (error) {
    return { error: 'No package.json found' };
  }
}

async function scanDirectory(dir, ig) {
  const files = await fs.readdir(dir);
  let contents = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = await fs.stat(fullPath);
    
    // Skip if file/directory is ignored
    if (ig.ignores(fullPath)) continue;

    if (stat.isDirectory()) {
      if (!config.excludedDirs.includes(file)) {
        const subContents = await scanDirectory(fullPath, ig);
        contents = [...contents, ...subContents];
      }
    } else {
      const ext = path.extname(file);
      if (config.includedExtensions.includes(ext)) {
        const content = await fs.readFile(fullPath, 'utf8');
        const lineCount = content.split(/\r?\n/).length;
        const language = languageMapping[ext] || 'Unknown';
        contents.push({
          path: fullPath,
          extension: ext,
          language,
          lineCount,
          content
        });
      }
    }
  }
  
  return contents;
}

async function generateAnalysisFile() {
  try {
    // Initialize ignore patterns
    const ig = ignore().add([
      ...config.excludedDirs,
      '*.log',
      '*.lock',
      '*.md'
    ]);

    // Gather all information
    const gitInfo = await getGitInfo();
    const dependencies = await getDependencies();
    const files = await scanDirectory('.', ig);

    // Compute additional metadata
    const totalFiles = files.length;
    let totalLines = 0;
    const languagesSummary = {};

    files.forEach(file => {
      totalLines += file.lineCount;
      languagesSummary[file.language] = (languagesSummary[file.language] || 0) + 1;
    });

    // Build structured output
    const analysis = {
      metadata: {
        analysisTimestamp: new Date().toISOString(),
        totalFiles,
        totalLines,
        languagesSummary
      },
      gitInfo,
      dependencies,
      files
    };

    // Write structured JSON output
    await fs.writeFile(config.outputFile, JSON.stringify(analysis, null, 2));
    console.log(`Analysis complete! Output written to ${config.outputFile}`);

  } catch (error) {
    console.error('Error generating analysis:', error);
  }
}

// Execute the analysis
generateAnalysisFile();

