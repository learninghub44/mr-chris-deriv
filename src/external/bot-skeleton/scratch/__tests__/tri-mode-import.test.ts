jest.mock('@deriv-com/translations', () => {
    const interpolate = (text: string, values: Record<string, string> = {}) =>
        text.replace(/{{(.*?)}}/g, (match, key: string) => values[key.trim()] ?? match);

    return {
        getAllowedLanguages: jest.fn(() => ({ EN: 'English' })),
        getInitialLanguage: jest.fn(() => 'EN'),
        initializeI18n: jest.fn(),
        localize: jest.fn(interpolate),
        Localize: ({
            i18n_default_text,
            values = {},
        }: {
            i18n_default_text: string;
            values?: Record<string, string>;
        }) => interpolate(i18n_default_text, values),
        TranslationProvider: ({ children }: { children: unknown }) => children,
        useTranslations: () => ({
            currentLang: 'EN',
            localize: interpolate,
        }),
    };
});

import fs from 'fs';
import path from 'path';
import { loadBlockly } from '@/external/bot-skeleton/scratch/blockly';
import DBotStore from '@/external/bot-skeleton/scratch/dbot-store';
import { isAllRequiredBlocksEnabled } from '@/external/bot-skeleton/scratch/utils';

const BOT_FILE_PATH = path.join(
    process.cwd(),
    'public',
    'riskmanagers.site',
    'Tri-Mode Regime Switcher (Template Fixed).xml'
);

describe('Tri-Mode Blockly workspace import', () => {
    beforeAll(async () => {
        await loadBlockly(false);
        window.Blockly.Block.prototype.initSvg ??= jest.fn();
        window.Blockly.Block.prototype.queueRender ??= jest.fn();
        window.Blockly.Block.prototype.renderEfficiently ??= jest.fn();
        DBotStore.singleton = {
            client: {
                currency: 'USD',
                is_logged_in: true,
                loginid: 'CRTEST',
            },
        };
    });

    it('loads every block and satisfies mandatory purchase validation', () => {
        const workspace = new window.Blockly.Workspace();
        window.Blockly.derivWorkspace = workspace;
        const xml = window.Blockly.utils.xml.textToDom(fs.readFileSync(BOT_FILE_PATH, 'utf8'));

        expect(() => window.Blockly.Xml.domToWorkspace(xml, workspace)).not.toThrow();

        const blocks = workspace.getAllBlocks(false);
        const loaded_block_ids = new Set(blocks.map(block => block.id));
        const source_block_ids = Array.from(xml.querySelectorAll('block')).map(block => block.getAttribute('id'));
        expect(source_block_ids.every(block_id => block_id && loaded_block_ids.has(block_id))).toBe(true);
        expect(blocks.filter(block => block.type === 'smart_purchase_contract')).toHaveLength(1);
        expect(blocks.filter(block => block.type === 'purchase')).toHaveLength(0);
        expect(blocks.filter(block => block.type === 'trade_again')).toHaveLength(1);
        expect(blocks.some(block => block.disabled)).toBe(false);
        expect(isAllRequiredBlocksEnabled(workspace)).toBe(true);

        const variable_db = new window.Blockly.Names('window');
        variable_db.variableMap = workspace.getVariableMap();
        window.Blockly.JavaScript.variableDB_ = variable_db;
        const generated_code = window.Blockly.JavaScript.javascriptGenerator.workspaceToCode(workspace);
        expect(generated_code).not.toContain('.includes(');
        expect(generated_code).not.toContain('Bot.failExecutionCondition');
        expect(generated_code).not.toContain('DIGITDIFF');
        expect(generated_code).not.toContain('STAKE_FACTOR');
        expect(generated_code).toContain('Bot.getRecentTickAnalysisData(historySize)');
        expect(generated_code).toContain('Purchase request:');
        expect(generated_code).toContain('preserve_duration');
        expect(generated_code.indexOf('Bot.getRecentTickAnalysisData(historySize)')).toBeLessThan(
            generated_code.indexOf('Bot.purchase(contractType)')
        );

        workspace.dispose();
    });

    it('analyses fresh history before every signal and follows the exact six-contract sequence', () => {
        const workspace = new window.Blockly.Workspace();
        const analysis = workspace.newBlock('tri_mode_regime_signal');
        const history = workspace.newBlock('math_number');
        const sequence_step = workspace.newBlock('math_number');
        history.setFieldValue('100', 'NUM');
        sequence_step.setFieldValue('0', 'NUM');
        analysis.getInput('HISTORY')?.connection?.connect(history.outputConnection);
        analysis.getInput('SEQUENCE_STEP')?.connection?.connect(sequence_step.outputConnection);

        const generator = window.Blockly.JavaScript.javascriptGenerator;
        generator.init(workspace);
        const notify = jest.fn();
        const getRecentTickAnalysisData = jest.fn(() => ({
            digits: Array.from({ length: 100 }, (_, index) => index % 10),
            ticks: Array.from({ length: 100 }, (_, index) => 100 + index * 0.01),
        }));
        const bot = {
            getRecentTickAnalysisData,
            notify,
        };
        const evaluate = (step: number) => {
            sequence_step.setFieldValue(String(step), 'NUM');
            const [code] = generator.forBlock.tri_mode_regime_signal(analysis);
            return new Function('Bot', `return ${code};`)(bot);
        };

        expect([0, 1, 2, 3, 4, 5, 6].map(evaluate)).toEqual([20, 21, 22, 23, 30, 31, 20]);
        expect(getRecentTickAnalysisData).toHaveBeenCalledTimes(7);
        expect(getRecentTickAnalysisData).toHaveBeenCalledWith(100);
        expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('Direct Deriv analysis before purchase'),
            })
        );

        workspace.dispose();
    });

    it.each([
        [20, 'DIGITOVER', 4],
        [21, 'DIGITUNDER', 5],
        [22, 'DIGITEVEN', 0],
        [23, 'DIGITODD', 0],
        [30, 'CALL', 0],
        [31, 'PUT', 0],
    ])('maps signal %s to %s with prediction %s', (signal, expected_contract, expected_prediction) => {
        const workspace = new window.Blockly.Workspace();
        const signal_block = workspace.newBlock('math_number');
        signal_block.setFieldValue(String(signal), 'NUM');
        const value_block = workspace.newBlock('tri_mode_signal_value');
        value_block.getInput('SIGNAL')?.connection?.connect(signal_block.outputConnection);
        const generator = window.Blockly.JavaScript.javascriptGenerator;
        generator.init(workspace);

        value_block.setFieldValue('CONTRACT', 'VALUE_TYPE');
        const [contract_code] = generator.forBlock.tri_mode_signal_value(value_block);
        value_block.setFieldValue('PREDICTION', 'VALUE_TYPE');
        const [prediction_code] = generator.forBlock.tri_mode_signal_value(value_block);

        expect(new Function(`return ${contract_code};`)()).toBe(expected_contract);
        expect(new Function(`return ${prediction_code};`)()).toBe(expected_prediction);

        workspace.dispose();
    });
});
