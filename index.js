#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('./package.json');

const getAllFiles = (dir, files = []) => {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			getAllFiles(fullPath, files);
		} else {
			files.push(fullPath);
		}
	}
	return files;
};

const findMainResxFiles = dir => getAllFiles(dir).filter(f => f.endsWith('.resx') && !(/\.[a-z]{2}(-[A-Z]{2})?\.resx$/).test(f));
const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findUsedKeys = (keys, files) => {
	const used = new Set();
	if (keys.length === 0) return used;

	const pattern = new RegExp(`\\b(?:Resources|Properties\\.Resources)\\.(${keys.map(escapeRegex).join('|')})\\b`, 'g');
	for (const file of files) {
		if (!(/\.(cs|cshtml|xaml)$/i).test(file)) continue;
		const content = fs.readFileSync(file, 'utf-8');
		let match;
		while ((match = pattern.exec(content)) !== null) {
			used.add(match[1]);
		}
	}
	return used;
};

const cleanSingleResx = (resxPath, projectFiles, projectDir) => {
	let content = fs.readFileSync(resxPath, 'utf-8');
	const comments = [];
	content = content.replace(/<!--[\s\S]*?-->/g, match => {
		comments.push(match);
		return `<!--__COMMENT_${comments.length - 1}__-->`;
	});

	const dataRegex = /<data[^>]+name="([^"]+)"[^>]*>[\s\S]*?<\/data>/g;
	const keys = [];
	const rawBlocks = [];
	let totalKeys = 0;
	let match;
	while ((match = dataRegex.exec(content)) !== null) {
		totalKeys++;

		const fullBlock = match[0];
		const name = match[1];
		const isIgnorable = name.startsWith('>>') || name.startsWith('$this.') || name.includes('.') || fullBlock.includes('mimetype=') || fullBlock.includes('type=');
		if (!isIgnorable) {
			keys.push(name);
			rawBlocks.push({ name, raw: fullBlock });
		}
	}

	const used = findUsedKeys(keys, projectFiles);
	const unused = rawBlocks.filter(e => !used.has(e.name));
	if (unused.length > 0) {
		console.log(`${path.relative(projectDir, resxPath)} – removing ${unused.length} unused string(s):`);
		unused.forEach(e => console.log(`   • ${e.name}`));
	}

	for (const e of unused) {
		const pattern = new RegExp(`\\s*<data[^>]+name="${escapeRegex(e.name)}"[^>]*>[\\s\\S]*?<\\/data>\\s*`, 'g');
		content = content.replace(pattern, '\n  ');
	}

	content = content.replace(/<!--__COMMENT_(\d+)__-->/g, (_, index) => comments[Number(index)]);
	fs.writeFileSync(resxPath, content.trim(), 'utf-8');
	console.log(`${path.relative(projectDir, resxPath)} – cleanup completed`);
	return { totalKeys, removedKeys: unused.length };
};

const resxCleanup = projectDirs => {
	if (!projectDirs) {
		console.error('Missing project paths. Please provide at least one path.');
		process.exit(1);
	}

	const dirs = Array.isArray(projectDirs) ? projectDirs : [projectDirs];
	const overallStats = { totalDirs: dirs.length, totalProjectFiles: 0, totalResxFiles: 0, totalKeys: 0, totalRemovedKeys: 0 };

	for (const dir of dirs) {
		console.log(`\n---------- ${dir} ----------`);

		const projectFiles = getAllFiles(dir);
		const resxFiles = findMainResxFiles(dir);
		overallStats.totalProjectFiles += projectFiles.length;
		overallStats.totalResxFiles += resxFiles.length;
		if (resxFiles.length === 0) {
			console.log('No main .resx files found!');
			continue;
		} else {
			console.log(`Detected ${resxFiles.length} main .resx file(s). Starting cleanup...`);
		}

		for (const resx of resxFiles) {
			try {
				const fileStats = cleanSingleResx(resx, projectFiles, dir);
				overallStats.totalKeys += fileStats.totalKeys;
				overallStats.totalRemovedKeys += fileStats.removedKeys;
			} catch (err) {
				console.error(`Failed to process file ${resx}: ${err.message}`);
			}
		}
	}

	console.log(`\nScanned a total of ${overallStats.totalProjectFiles} project file(s) across ${overallStats.totalDirs} director${overallStats.totalDirs > 1 ? 'ies' : 'y'}.`);
	console.log('Total main .resx files processed:', overallStats.totalResxFiles);
	console.log('Total keys found:', overallStats.totalKeys);
	console.log('Total unused keys removed:', overallStats.totalRemovedKeys);
};

if (require.main === module) {
	const args = process.argv.slice(2);
	if (args.includes('--version')) {
		console.log(version);
		process.exit(0);
	}

	const projectIndex = args.indexOf('--project');
	let projectPaths = null;
	if (projectIndex !== -1 && args[projectIndex + 1]) projectPaths = args[projectIndex + 1].split(',').map(p => p.trim());

	resxCleanup(projectPaths);
}

module.exports = { resxCleanup, version };