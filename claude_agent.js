require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// ----------------------------
// CONFIG
// ----------------------------
const MODEL = "claude-sonnet-4-20250514";  // Fast and capable
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 50;  // Safety limit
const WORKSPACE = process.cwd();

// ----------------------------
// TOOLS DEFINITION
// ----------------------------
const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file. Use this to examine code, configs, logs, or any text file.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative or absolute file path"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative or absolute file path"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "edit_file",
    description: "Replace a specific string in a file. Use for targeted edits without rewriting the whole file.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path"
        },
        old_string: {
          type: "string",
          description: "Exact string to find and replace"
        },
        new_string: {
          type: "string",
          description: "Replacement string"
        }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  {
    name: "list_files",
    description: "List files and directories in a path. Use to explore the codebase structure.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path (default: current directory)"
        },
        pattern: {
          type: "string",
          description: "Optional glob pattern to filter (e.g., '*.js')"
        }
      },
      required: []
    }
  },
  {
    name: "run_command",
    description: "Execute a shell command. Use for running scripts, git, npm, node, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "search_files",
    description: "Search for a pattern in files. Returns matching lines with file paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for"
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current)"
        },
        file_pattern: {
          type: "string",
          description: "File glob pattern (e.g., '*.js')"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their response. Use when you need clarification or approval.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Question to ask the user"
        }
      },
      required: ["question"]
    }
  },
  {
    name: "task_complete",
    description: "Signal that the task is complete. Use when you've finished the requested work.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of what was accomplished"
        }
      },
      required: ["summary"]
    }
  }
];

// ----------------------------
// TOOL IMPLEMENTATIONS
// ----------------------------
function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(WORKSPACE, filePath);
}

async function executeTool(name, input) {
  console.log(`\n  [TOOL] ${name}`, input.path || input.command || input.pattern || '');

  try {
    switch (name) {
      case "read_file": {
        const fullPath = resolvePath(input.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${input.path}`;
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        // Truncate very long files
        if (content.length > 50000) {
          return content.slice(0, 50000) + '\n\n[... truncated, file too long ...]';
        }
        return content;
      }

      case "write_file": {
        const fullPath = resolvePath(input.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, input.content);
        return `File written: ${input.path} (${input.content.length} bytes)`;
      }

      case "edit_file": {
        const fullPath = resolvePath(input.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${input.path}`;
        }
        let content = fs.readFileSync(fullPath, 'utf8');
        if (!content.includes(input.old_string)) {
          return `Error: String not found in file. Make sure you're using the exact string.`;
        }
        content = content.replace(input.old_string, input.new_string);
        fs.writeFileSync(fullPath, content);
        return `File edited: ${input.path}`;
      }

      case "list_files": {
        const fullPath = resolvePath(input.path || '.');
        if (!fs.existsSync(fullPath)) {
          return `Error: Path not found: ${input.path}`;
        }
        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = items
          .filter(item => {
            if (input.pattern) {
              const regex = new RegExp(input.pattern.replace('*', '.*'));
              return regex.test(item.name);
            }
            return true;
          })
          .map(item => `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`)
          .join('\n');
        return result || '(empty directory)';
      }

      case "run_command": {
        const timeout = input.timeout || 30000;
        try {
          const output = execSync(input.command, {
            cwd: WORKSPACE,
            timeout: timeout,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            shell: true
          });
          return output || '(command completed with no output)';
        } catch (err) {
          if (err.stdout || err.stderr) {
            return `Exit code ${err.status || 1}:\n${err.stdout || ''}${err.stderr || ''}`;
          }
          return `Error: ${err.message}`;
        }
      }

      case "search_files": {
        const searchPath = resolvePath(input.path || '.');
        const filePattern = input.file_pattern || '*';
        try {
          // Use grep on Unix, findstr on Windows
          const isWindows = process.platform === 'win32';
          let cmd;
          if (isWindows) {
            cmd = `findstr /S /N /R /C:"${input.pattern}" ${filePattern}`;
          } else {
            cmd = `grep -r -n "${input.pattern}" --include="${filePattern}" .`;
          }
          const output = execSync(cmd, {
            cwd: searchPath,
            encoding: 'utf8',
            maxBuffer: 5 * 1024 * 1024
          });
          const lines = output.split('\n').slice(0, 50);  // Limit results
          return lines.join('\n') || 'No matches found';
        } catch (err) {
          if (err.status === 1) return 'No matches found';
          return `Search error: ${err.message}`;
        }
      }

      case "ask_user": {
        const answer = await askQuestion(input.question);
        return answer;
      }

      case "task_complete": {
        return `TASK_COMPLETE: ${input.summary}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error executing ${name}: ${err.message}`;
  }
}

// ----------------------------
// USER INPUT
// ----------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(prompt) {
  return new Promise((resolve) => {
    rl.question(`\n  [USER INPUT NEEDED] ${prompt}\n  > `, (answer) => {
      resolve(answer);
    });
  });
}

// ----------------------------
// AGENT LOOP
// ----------------------------
async function runAgent(initialPrompt) {
  const anthropic = new Anthropic();

  const systemPrompt = `You are an autonomous AI agent with access to a development environment.
You can read, write, and edit files, run commands, and search code.

WORKSPACE: ${WORKSPACE}

Your capabilities:
- read_file: Read any file
- write_file: Create or overwrite files
- edit_file: Make targeted edits (find/replace)
- list_files: Explore directory structure
- run_command: Execute shell commands (node, npm, git, etc.)
- search_files: Search for patterns in code
- ask_user: Ask for clarification when needed
- task_complete: Signal when done

Guidelines:
1. Read files before editing to understand context
2. Make incremental changes and test frequently
3. Use run_command to verify your changes work
4. Ask the user if requirements are unclear
5. Call task_complete when finished

You are working on a trading bot system. The main files are:
- live_trader.js: Live paper trading system
- batch_trainer.js: Backtesting/training system
- agents/: AI trading agents (direction, confidence, levels)
- trade_indicators.js: Technical indicators
- strategy_selector.js: Strategy orchestration`;

  let messages = [
    { role: "user", content: initialPrompt }
  ];

  console.log('\n' + '='.repeat(60));
  console.log('CLAUDE AGENT STARTED');
  console.log('='.repeat(60));
  console.log(`\nTask: ${initialPrompt}\n`);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`\n--- Iteration ${i + 1} ---`);

    // Call Claude
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: TOOLS,
      messages: messages
    });

    // Process response
    let assistantContent = [];
    let toolResults = [];
    let taskComplete = false;

    for (const block of response.content) {
      if (block.type === 'text') {
        console.log(`\n  [THINKING] ${block.text.slice(0, 200)}${block.text.length > 200 ? '...' : ''}`);
        assistantContent.push(block);
      }
      else if (block.type === 'tool_use') {
        assistantContent.push(block);

        // Execute the tool
        const result = await executeTool(block.name, block.input);

        // Check for task completion
        if (result.startsWith('TASK_COMPLETE:')) {
          console.log(`\n  [COMPLETE] ${result.slice(15)}`);
          taskComplete = true;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result
        });
      }
    }

    // Add assistant response to messages
    messages.push({ role: "assistant", content: assistantContent });

    // If there were tool uses, add results
    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    // Check if done
    if (taskComplete) {
      console.log('\n' + '='.repeat(60));
      console.log('AGENT COMPLETED TASK');
      console.log('='.repeat(60));
      break;
    }

    // Check if Claude stopped without tool use (final response)
    if (response.stop_reason === 'end_turn' && !response.content.some(b => b.type === 'tool_use')) {
      console.log('\n  [FINAL RESPONSE]');
      const textContent = response.content.find(b => b.type === 'text');
      if (textContent) {
        console.log(textContent.text);
      }
      break;
    }
  }

  rl.close();
  return messages;
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Interactive mode
    const task = await askQuestion('What would you like me to do?');
    await runAgent(task);
  } else {
    // Command line mode
    const task = args.join(' ');
    await runAgent(task);
  }
}

main().catch(err => {
  console.error('Agent error:', err);
  process.exit(1);
});
