const { afterEach, beforeEach, describe, expect, it, jest: jestGlobals } = require('@jest/globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getAllFiles, findMainResxFiles, escapeRegex, findUsedKeys, cleanSingleResx, resxCleanup } = require('../index.js');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resx-cleanup-'));

describe('resx-cleanup', () => {
	describe('#escapeRegex', () => {
		it('should escape regex special characters', () => {
			expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
			expect(escapeRegex('Key(1)')).toBe('Key\\(1\\)');
		});

		it('should leave plain identifiers untouched', () => {
			expect(escapeRegex('MyErrorMessage')).toBe('MyErrorMessage');
		});
	});

	describe('#findMainResxFiles', () => {
		it('should keep files with exactly one dot before .resx', () => {
			const files = ['Resources.resx', 'Forms/AboutForm.resx'];
			expect(findMainResxFiles(files)).toEqual(files);
		});

		it('should exclude locale-suffixed files with a language or region code', () => {
			expect(findMainResxFiles(['Resources.pl.resx', 'Resources.pt-BR.resx'])).toEqual([]);
		});

		it('should exclude script-subtag locales like zh-Hans/zh-Hant (regression)', () => {
			expect(findMainResxFiles(['Resources.zh-Hans.resx', 'Resources.zh-Hant.resx'])).toEqual([]);
		});

		it('should ignore non-resx files', () => {
			expect(findMainResxFiles(['Program.cs', 'notes.txt'])).toEqual([]);
		});
	});

	describe('#findUsedKeys', () => {
		it('should detect direct Resources.Key usage', () => {
			const used = findUsedKeys(['ErrorTitle'], ['MessageBox.Show(Resources.ErrorTitle);']);
			expect(used.has('ErrorTitle')).toBe(true);
		});

		it('should detect Properties.Resources.Key usage', () => {
			const used = findUsedKeys(['ErrorTitle'], ['var x = Properties.Resources.ErrorTitle;']);
			expect(used.has('ErrorTitle')).toBe(true);
		});

		it('should not flag keys that are not referenced anywhere', () => {
			const used = findUsedKeys(['UnusedKey'], ['Resources.OtherKey']);
			expect(used.has('UnusedKey')).toBe(false);
		});

		it('should return an empty set when no keys are given', () => {
			expect(findUsedKeys([], ['Resources.Anything']).size).toBe(0);
		});
	});

	describe('#getAllFiles', () => {
		let dir;

		beforeEach(() => {
			dir = makeTempDir();
		});

		afterEach(() => {
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it('should recursively collect files', () => {
			fs.writeFileSync(path.join(dir, 'a.txt'), '');
			fs.mkdirSync(path.join(dir, 'sub'));
			fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), '');

			const files = getAllFiles(dir).map(f => path.relative(dir, f)).sort();
			expect(files).toEqual(['a.txt', path.join('sub', 'b.txt')].sort());
		});

		it('should skip .git, node_modules, bin, obj, .vs and .idea directories', () => {
			for (const skipped of ['.git', 'node_modules', 'bin', 'obj', '.vs', '.idea']) {
				fs.mkdirSync(path.join(dir, skipped));
				fs.writeFileSync(path.join(dir, skipped, 'ignored.txt'), '');
			}
			fs.writeFileSync(path.join(dir, 'kept.txt'), '');

			expect(getAllFiles(dir).map(f => path.basename(f))).toEqual(['kept.txt']);
		});
	});

	describe('#cleanSingleResx', () => {
		let dir;
		let resxPath;

		beforeEach(() => {
			dir = makeTempDir();
			resxPath = path.join(dir, 'Resources.resx');
			jestGlobals.spyOn(console, 'log').mockImplementation(() => undefined);
		});

		afterEach(() => {
			jestGlobals.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		});

		const writeResx = body => fs.writeFileSync(resxPath, `<root>\n${body}\n</root>`, 'utf-8');

		it('should remove entries that are not referenced in any source file', () => {
			writeResx(`
  <data name="UsedKey" xml:space="preserve"><value>Used</value></data>
  <data name="UnusedKey" xml:space="preserve"><value>Unused</value></data>
`);

			const stats = cleanSingleResx(resxPath, ['Resources.UsedKey'], dir);

			expect(stats).toEqual({ totalKeys: 2, removedKeys: 1 });
			const result = fs.readFileSync(resxPath, 'utf-8');
			expect(result).toContain('UsedKey');
			expect(result).not.toContain('UnusedKey');
		});

		it('should never remove keys containing a dot (designer control properties)', () => {
			writeResx('  <data name="linkLabel1.Text" xml:space="preserve"><value>Click here</value></data>');

			const stats = cleanSingleResx(resxPath, [], dir);

			expect(stats).toEqual({ totalKeys: 1, removedKeys: 0 });
			expect(fs.readFileSync(resxPath, 'utf-8')).toContain('linkLabel1.Text');
		});

		it('should never remove entries with a type attribute (designer metadata)', () => {
			writeResx('  <data name="BackColorValue" type="System.Drawing.Color, System.Drawing"><value>White</value></data>');

			const stats = cleanSingleResx(resxPath, [], dir);

			expect(stats).toEqual({ totalKeys: 1, removedKeys: 0 });
			expect(fs.readFileSync(resxPath, 'utf-8')).toContain('BackColorValue');
		});

		it('should never remove entries whose name starts with >>', () => {
			writeResx('  <data name="&gt;&gt;SomeDesignerMetadata" xml:space="preserve"><value>x</value></data>');

			const stats = cleanSingleResx(resxPath, [], dir);

			expect(stats).toEqual({ totalKeys: 1, removedKeys: 0 });
		});

		it('should preserve XML comments untouched', () => {
			writeResx(`
  <!-- Microsoft ResX Schema -->
  <data name="UnusedKey" xml:space="preserve"><value>Unused</value></data>
`);

			cleanSingleResx(resxPath, [], dir);

			expect(fs.readFileSync(resxPath, 'utf-8')).toContain('<!-- Microsoft ResX Schema -->');
		});
	});

	describe('#resxCleanup', () => {
		let dir;

		beforeEach(() => {
			dir = makeTempDir();
			jestGlobals.spyOn(console, 'log').mockImplementation(() => undefined);
		});

		afterEach(() => {
			jestGlobals.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it('should throw when called without a project path', () => {
			expect(() => resxCleanup(null)).toThrow('Missing project paths');
		});

		it('should clean a project end-to-end while leaving translated and build-output resx files untouched', () => {
			fs.mkdirSync(path.join(dir, 'Forms'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'Forms', 'MainForm.cs'), 'MessageBox.Show(Resources.KeptKey);');
			fs.writeFileSync(
				path.join(dir, 'Forms', 'MainForm.resx'),
				'<root>\n  <data name="KeptKey" xml:space="preserve"><value>Kept</value></data>\n  <data name="RemovedKey" xml:space="preserve"><value>Removed</value></data>\n</root>',
				'utf-8'
			);
			fs.writeFileSync(
				path.join(dir, 'Forms', 'MainForm.pl.resx'),
				'<root>\n  <data name="KeptKey" xml:space="preserve"><value>Zachowany</value></data>\n  <data name="RemovedKey" xml:space="preserve"><value>Usunięty</value></data>\n</root>',
				'utf-8'
			);

			fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
			fs.writeFileSync(
				path.join(dir, 'bin', 'Stale.resx'),
				'<root>\n  <data name="ShouldNeverBeTouched" xml:space="preserve"><value>x</value></data>\n</root>',
				'utf-8'
			);

			resxCleanup([dir]);

			const main = fs.readFileSync(path.join(dir, 'Forms', 'MainForm.resx'), 'utf-8');
			expect(main).toContain('KeptKey');
			expect(main).not.toContain('RemovedKey');

			const translated = fs.readFileSync(path.join(dir, 'Forms', 'MainForm.pl.resx'), 'utf-8');
			expect(translated).toContain('KeptKey');
			expect(translated).toContain('RemovedKey');

			const stale = fs.readFileSync(path.join(dir, 'bin', 'Stale.resx'), 'utf-8');
			expect(stale).toContain('ShouldNeverBeTouched');
		});

		it('should accept a single directory string as well as an array', () => {
			fs.writeFileSync(path.join(dir, 'Empty.resx'), '<root>\n  <data name="OnlyKey" xml:space="preserve"><value>x</value></data>\n</root>', 'utf-8');

			expect(() => resxCleanup(dir)).not.toThrow();
		});
	});
});
