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

const findMainResxFiles = dir =>
	getAllFiles(dir)
		.filter(f => f.endsWith('.resx'))
		.filter(f => !(/\.[a-z]{2}(-[A-Z]{2})?\.resx$/).test(f));

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
	let original = fs.readFileSync(resxPath, 'utf-8');
	const comments = [];
	original = original.replace(/<!--[\s\S]*?-->/g, match => {
		comments.push(match);
		return `<!--__COMMENT_${comments.length - 1}__-->`;
	});

	const dataRegex = /<data[^>]+name="([^"]+)"[^>]*>[\s\S]*?<\/data>/g;
	const keys = [];
	const rawBlocks = [];
	let match;
	while ((match = dataRegex.exec(original)) !== null) {
		const fullBlock = match[0];
		const name = match[1];
		const isIgnorable =
            name.startsWith('>>') ||
            name.startsWith('$this.') ||
            name.includes('.') ||
            fullBlock.includes('mimetype=') ||
            fullBlock.includes('type=');
		if (!isIgnorable) {
			keys.push(name);
			rawBlocks.push({ name, raw: fullBlock });
		}
	}

	const used = findUsedKeys(keys, projectFiles);
	const unused = rawBlocks.filter((e) => !used.has(e.name));
	if (unused.length > 0) {
		console.log(`${path.relative(projectDir, resxPath)} – removing ${unused.length} unused string(s):`);
		for (const e of unused) console.log(`   • ${e.name}`);
	}

	for (const e of unused) {
		const pattern = new RegExp(`\\s*<data[^>]+name="${escapeRegex(e.name)}"[^>]*>[\\s\\S]*?<\\/data>\\s*`, 'g');
		original = original.replace(pattern, '\n  ');
	}

	original = original.replace(/<!--__COMMENT_(\d+)__-->/g, (_, index) => comments[Number(index)]);
	fs.writeFileSync(resxPath, original.trim() + '\n', 'utf-8');

	console.log(`${path.relative(projectDir, resxPath)} – cleanup completed`);
	return { totalKeys: keys.length, removedKeys: unused.length };
};

const main = projectDir => {
	if (!projectDir) {
		console.error('Project path is missing. Please provide a valid path.');
		process.exit(1);
	}

	console.log(`\n---------- ${projectDir} ----------`);
	const projectFiles = getAllFiles(projectDir);
	const resxFiles = findMainResxFiles(projectDir);
	if (resxFiles.length === 0) console.log('No main .resx files found!');

	console.log(`Detected ${resxFiles.length} main .resx file(s). Starting cleanup...`);
	const stats = { resxFiles: resxFiles.length, totalKeys: 0, removedKeys: 0 };
	for (const resx of resxFiles) {
		try {
			const fileStats = cleanSingleResx(resx, projectFiles, projectDir);
			stats.totalKeys += fileStats.totalKeys;
			stats.removedKeys += fileStats.removedKeys;
		} catch (err) {
			console.error(`Failed to process file ${resx}: ${err.message}`);
		}
	}

	console.log(`\nScanned a total of ${projectFiles.length} project file(s)`);
	console.log('Total main .resx files processed:', stats.resxFiles);
	console.log('Total keys found:', stats.totalKeys);
	console.log('Total unused keys removed:', stats.removedKeys);
};

if (require.main === module) {
	const args = process.argv.slice(2);
	if (args.includes('--version')) {
		console.log(version);
		process.exit(0);
	}

	const projectIndex = args.indexOf('--project');
	const projectPath = projectIndex !== -1 && args[projectIndex + 1] ? args[projectIndex + 1] : null;
	main(projectPath);
}

module.exports = main;