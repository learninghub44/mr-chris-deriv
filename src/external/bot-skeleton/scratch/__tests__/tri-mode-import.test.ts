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
        expect(generated_code).toContain('Purchase request:');
        expect(generated_code).toContain('preserve_duration');

        workspace.dispose();
    });

    it('selects the strongest recent digit other than the previous Differs prediction', () => {
        const workspace = new window.Blockly.Workspace();
        const predictor = workspace.newBlock('rotating_differ_prediction');
        const count = workspace.newBlock('math_number');
        const previous_digit = workspace.newBlock('math_number');
        count.setFieldValue('5', 'NUM');
        previous_digit.setFieldValue('4', 'NUM');
        predictor.getInput('COUNT')?.connection?.connect(count.outputConnection);
        predictor.getInput('PREVIOUS_DIGIT')?.connection?.connect(previous_digit.outputConnection);

        const generator = window.Blockly.JavaScript.javascriptGenerator;
        generator.init(workspace);
        const [code] = generator.forBlock.rotating_differ_prediction(predictor);
        const notify = jest.fn();
        const evaluate_prediction = new Function('Bot', `return ${code};`);
        const prediction = evaluate_prediction({
            getLastDigitList: () => [4, 4, 4, 7, 7],
            notify,
        });

        expect(prediction).toBe(7);
        expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('excluded previous digit 4'),
            })
        );

        workspace.dispose();
    });

    it('selects all three regimes and cools down when the losing mode is the only signal', () => {
        const workspace = new window.Blockly.Workspace();
        const analysis = workspace.newBlock('tri_mode_regime_signal');
        const input_values = {
            AVOID_MODE: 0,
            EVALUATION_TICKS: 20,
            HISTORY: 100,
            COOLDOWN_TICKS: 5,
            DIFFERS_THRESHOLD: 14,
            BIAS_THRESHOLD: 58,
            FLAT_THRESHOLD: 55,
            TREND_TICKS: 3,
            RANGE_TICKS: 10,
            MAX_RANGE: 0.6,
        };
        const number_blocks = Object.entries(input_values).map(([input_name, value]) => {
            const number_block = workspace.newBlock('math_number');
            number_block.setFieldValue(String(value), 'NUM');
            analysis.getInput(input_name)?.connection?.connect(number_block.outputConnection);
            return number_block;
        });
        const generator = window.Blockly.JavaScript.javascriptGenerator;
        generator.init(workspace);
        const [code] = generator.forBlock.tri_mode_regime_signal(analysis);
        const evaluate_signal = new Function('Bot', 'BinaryBotPrivateTriModeState', `return ${code};`);
        const repeat_digit = (digit: number, count: number) => Array.from({ length: count }, () => digit);
        const mode_a_digits = [
            ...repeat_digit(0, 10),
            ...repeat_digit(1, 10),
            ...repeat_digit(2, 10),
            ...repeat_digit(3, 10),
            ...repeat_digit(4, 10),
            ...repeat_digit(5, 9),
            ...repeat_digit(6, 9),
            ...repeat_digit(7, 15),
            ...repeat_digit(8, 9),
            ...repeat_digit(9, 8),
        ];
        const mode_b_digits = Array.from({ length: 10 }, (_, digit) => repeat_digit(digit, digit < 5 ? 8 : 12)).flat();
        const mode_c_digits = Array.from({ length: 10 }, (_, digit) => repeat_digit(digit, 10)).flat();
        const choppy_ticks = [100, 101, 99, 101, 99, 101, 99, 101, 99, 101];
        const rising_ticks = [100, 100.05, 100.1, 100.15, 100.2, 100.25, 100.3, 100.35, 100.4, 100.45];
        const make_state = () => ({ ticks: 19, cooldown: 0, lastMode: 0, lastDiffersDigit: -1 });
        const evaluate = (digits: number[], ticks: number[], state = make_state()) =>
            evaluate_signal(
                {
                    getLastDigitList: () => digits,
                    getTicks: () => ticks,
                    notify: jest.fn(),
                },
                state
            );

        expect(evaluate(mode_a_digits, choppy_ticks)).toBe(17);
        expect(evaluate(mode_b_digits, choppy_ticks)).toBe(20);
        expect(evaluate(mode_c_digits, rising_ticks)).toBe(30);
        const repeated_differs_state = make_state();
        expect(evaluate(mode_a_digits, choppy_ticks, repeated_differs_state)).toBe(17);
        repeated_differs_state.ticks = 19;
        expect(evaluate(mode_a_digits, choppy_ticks, repeated_differs_state)).toBe(0);
        expect(repeated_differs_state.cooldown).toBe(5);

        number_blocks[0].setFieldValue('1', 'NUM');
        const [avoid_mode_code] = generator.forBlock.tri_mode_regime_signal(analysis);
        const evaluate_with_avoid = new Function('Bot', 'BinaryBotPrivateTriModeState', `return ${avoid_mode_code};`);
        const cooldown_state = make_state();
        expect(
            evaluate_with_avoid(
                {
                    getLastDigitList: () => mode_b_digits,
                    getTicks: () => choppy_ticks,
                    notify: jest.fn(),
                },
                make_state()
            )
        ).toBe(20);
        expect(
            evaluate_with_avoid(
                {
                    getLastDigitList: () => mode_a_digits,
                    getTicks: () => choppy_ticks,
                    notify: jest.fn(),
                },
                cooldown_state
            )
        ).toBe(0);
        expect(cooldown_state.cooldown).toBe(5);
        for (let cooldown_tick = 0; cooldown_tick < 5; cooldown_tick += 1) {
            expect(
                evaluate_with_avoid(
                    {
                        getLastDigitList: () => mode_b_digits,
                        getTicks: () => choppy_ticks,
                        notify: jest.fn(),
                    },
                    cooldown_state
                )
            ).toBe(0);
        }
        expect(cooldown_state).toEqual(
            expect.objectContaining({
                cooldown: 0,
                ticks: 0,
            })
        );
        for (let evaluation_tick = 0; evaluation_tick < 19; evaluation_tick += 1) {
            expect(
                evaluate_with_avoid(
                    {
                        getLastDigitList: () => mode_b_digits,
                        getTicks: () => choppy_ticks,
                        notify: jest.fn(),
                    },
                    cooldown_state
                )
            ).toBe(0);
        }
        expect(
            evaluate_with_avoid(
                {
                    getLastDigitList: () => mode_b_digits,
                    getTicks: () => choppy_ticks,
                    notify: jest.fn(),
                },
                cooldown_state
            )
        ).toBe(20);

        workspace.dispose();
    });
});
