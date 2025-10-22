import { App, Editor, MarkdownPostProcessorContext, TFile, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("loading my plugings");
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("tikz", async (source, el, ctx) => {
			const raw = source.trim();
			const folldata = `
\\documentclass{standalone}
\\usepackage{amsmath,amsfonts}
\\usepackage{tikz-cd}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\begin{document}
\\centering
${raw}
\\end{document}
							`.trim();
			try {
				// 使用 await 来等待 Promise 解析，将结果（string）赋值给 svgContent
				const svgContent = await compileTikzToSvg(folldata);
				//const svgContent = folldata;
				// svgContent 现在是一个 string，可以直接赋值给 innerHTML
				el.innerHTML = svgContent;

			} catch (error) {
				el.innerHTML = `<div style="color: red;">编译失败: ${error.message}</div>`;
			}
			el.addClass('tikz-output');
			el.style.margin = '10px auto';
			el.style.display = 'block';
		});

		//		This creates an icon in the left ribbon.

		//this.registerMarkdownCodeBlockProcessor("tikz", handlePlug());
		//		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (_evt: MouseEvent) => {
		//			// Called when the user clicks the icon.
		//			new Notice('This is a notice!');
		//		});
		//		// Perform additional things with the ribbon
		//		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.

		//		const statusBarItemEl = this.addStatusBarItem();
		//		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		//		this.addCommand({
		//			id: 'open-sample-modal-simple',
		//			name: 'Open sample modal (simple)',
		//			callback: () => {
		//				new SampleModal(this.app).open();
		//			}
		//		});
		//		// This adds an editor command that can perform some operation on the current editor instance
		//		this.addCommand({
		//			id: 'sample-editor-command',
		//			name: 'Sample editor command',
		//			editorCallback: (editor: Editor, _view: MarkdownView) => {
		//				console.log(editor.getSelection());
		//				editor.replaceSelection('Sample Editor Command');
		//			}
		//		});
		//		// This adds a complex command that can check whether the current state of the app allows execution of the command
		//		this.addCommand({
		//			id: 'open-sample-modal-complex',
		//			name: 'Open sample modal (complex)',
		//			checkCallback: (checking: boolean) => {
		//				// Conditions to check
		//				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		//				if (markdownView) {
		//					// If checking is true, we're simply "checking" if the command can be run.
		//					// If checking is false, then we want to actually perform the operation.
		//					if (!checking) {
		//						new SampleModal(this.app).open();
		//					}
		//
		//					// This command will only show up in Command Palette when the check function returns true
		//					return true;
		//				}
		//			}
		//		});
		//
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}

const TEMP_SUBDIR = 'obsidian-tikz-processor';

/**
 * 确保临时目录存在
 * @param dirPath 目录路径
 */
async function ensureDirExists(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (e) {
		// 忽略目录已存在的错误
		if (e.code !== 'EEXIST') {
			throw e;
		}
	}
}

/**
 * 编译 TikZ 代码块并将其转换为 SVG 字符串
 * @param tikzCode TikZ 代码块的原始内容
 * @returns 包含 SVG 代码的字符串
 */
export async function compileTikzToSvg(fullTexContent: string): Promise<string> {
	// 1. 设置临时文件路径和目录
	const tempDir = path.join(os.tmpdir(), TEMP_SUBDIR);
	await ensureDirExists(tempDir);

	// 使用随机数防止文件名冲突，确保每次运行的隔离性
	const baseName = `tikz_graph_${Date.now()}_${Math.random().toString(36).substring(2)}`;

	const texPath = path.join(tempDir, `${baseName}.tex`);
	const pdfPath = path.join(tempDir, `${baseName}.dvi`);
	const svgPath = path.join(tempDir, `${baseName}.svg`);

	// 2. 构建完整的 LaTeX 文档（包含 TiKZ 代码）

	// 3. 将内容写入 .tex 文件
	await fs.writeFile(texPath, fullTexContent, 'utf-8');

	// 4. 定义通用的命令行执行函数
	const runCommand = (cmd: string): Promise<void> => {
		return new Promise((resolve, reject) => {
			exec(cmd, { cwd: tempDir }, (error, stdout, stderr) => {
				if (error) {
					console.error(`命令行执行错误: ${stderr}`);
					return reject(new Error(`编译失败：${cmd}。请检查您的 TeX 依赖是否安装正确。`));
				}
				resolve();
			});
		});
	};

	// 5. 调用 pdflatex 编译 .tex 文件生成 PDF
	// -shell-escape 是为了某些特殊宏包，可能不需要，但最好排除
	// -interaction=batchmode 保持静默，不等待用户输入
	const latexCommand = `latex "${texPath}"`;
	try {
		await runCommand(latexCommand);
	} catch (e) {
		// 捕获并重新抛出错误
		throw new Error(`latex 编译失败: ${e.message}`);
	}

	// 6. 调用 dvisvgm 将 PDF 转换为 SVG
	const svgCommand = `dvisvgm "${pdfPath}" -o "${svgPath}"`;
	try {
		await runCommand(svgCommand);
	} catch (e) {
		// 捕获并重新抛出错误
		throw new Error(`dvipng 转换失败: ${e.message}`);
	}

	// 7. 读取并返回 SVG 文件内容
	const svgContent = await fs.readFile(svgPath, 'utf-8');

	// 8. (可选) 清理临时文件和目录
	// 这是一个复杂的步骤，这里为了简洁省略了，但生产插件中应清理所有生成文件

	return svgContent;
}
