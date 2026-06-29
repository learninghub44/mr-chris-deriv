import fs from 'fs';
import path from 'path';

const BOT_FILE_NAME = 'Tri-Mode Regime Switcher (Template Fixed).xml';
const BOT_FILE_PATH = path.join(process.cwd(), 'public', 'riskmanagers.site', BOT_FILE_NAME);
const CATALOG_FILE_PATH = path.join(process.cwd(), 'public', 'riskmanagers.site', 'bots.json');
const SMART_PURCHASE_FILE_PATH = path.join(
    process.cwd(),
    'src',
    'external',
    'bot-skeleton',
    'scratch',
    'blocks',
    'Binary',
    'Before Purchase',
    'smart_purchase_contract.js'
);
const TRI_MODE_SIGNAL_FILE_PATH = path.join(
    process.cwd(),
    'src',
    'external',
    'bot-skeleton',
    'scratch',
    'blocks',
    'Binary',
    'Tick Analysis',
    'tri_mode_regime_signal.js'
);
const TRI_MODE_VALUE_FILE_PATH = path.join(
    process.cwd(),
    'src',
    'external',
    'bot-skeleton',
    'scratch',
    'blocks',
    'Binary',
    'Tick Analysis',
    'tri_mode_signal_value.js'
);
const TRADE_ENGINE_FILE_PATH = path.join(
    process.cwd(),
    'src',
    'external',
    'bot-skeleton',
    'services',
    'tradeEngine',
    'trade',
    'index.js'
);

describe('Risk Managers Tri-Mode bot asset', () => {
    const xml_text = fs.readFileSync(BOT_FILE_PATH, 'utf8');
    const xml_document = new DOMParser().parseFromString(xml_text, 'application/xml');

    it('is well-formed Blockly XML with populated fields and unique block IDs', () => {
        expect(xml_document.querySelector('parsererror')).toBeNull();
        expect(xml_document.documentElement.nodeName).toBe('xml');
        expect(xml_document.documentElement.getAttribute('is_dbot')).toBe('true');

        const fields = Array.from(xml_document.querySelectorAll('field'));
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.every(field => field.textContent?.trim())).toBe(true);

        const block_ids = Array.from(xml_document.querySelectorAll('block'))
            .map(block => block.getAttribute('id'))
            .filter((id): id is string => Boolean(id));
        expect(new Set(block_ids).size).toBe(block_ids.length);
    });

    it('contains one dynamic purchase and one unconditional restart in the correct root blocks', () => {
        const before_purchase = xml_document.querySelector('block[type="before_purchase"]');
        const after_purchase = xml_document.querySelector('block[type="after_purchase"]');

        expect(before_purchase?.querySelectorAll('block[type="smart_purchase_contract"]')).toHaveLength(1);
        expect(before_purchase?.querySelectorAll('block[type="tri_mode_regime_signal"]')).toHaveLength(1);
        expect(before_purchase?.querySelectorAll('block[type="tri_mode_signal_value"]')).toHaveLength(3);
        expect(before_purchase?.querySelector('value[name="HISTORY"] field[name="NUM"]')?.textContent).toBe('100');
        expect(after_purchase?.querySelectorAll('block[type="trade_again"]')).toHaveLength(1);
        expect(
            after_purchase?.querySelector(
                'block[id="tm_advance_sequence"] > next > block[type="trade_again"]'
            )
        ).not.toBeNull();
    });

    it('uses fresh Deriv history and interpreter-compatible purchase code', () => {
        const smart_purchase_source = fs.readFileSync(SMART_PURCHASE_FILE_PATH, 'utf8');
        const tri_mode_signal_source = fs.readFileSync(TRI_MODE_SIGNAL_FILE_PATH, 'utf8');
        const tri_mode_value_source = fs.readFileSync(TRI_MODE_VALUE_FILE_PATH, 'utf8');
        const trade_engine_source = fs.readFileSync(TRADE_ENGINE_FILE_PATH, 'utf8');

        expect(smart_purchase_source).not.toContain('.includes(');
        expect(smart_purchase_source).toContain('.indexOf(contractType)');
        expect(smart_purchase_source).toContain('Purchase request:');
        expect(smart_purchase_source).toContain('preserve_duration  : true');
        expect(trade_engine_source).toContain('&& !should_preserve_duration');
        expect(tri_mode_signal_source).toContain('Bot.getRecentTickAnalysisData(historySize)');
        expect(tri_mode_signal_source).toContain("['OVER 4', 'UNDER 5', 'EVEN', 'ODD', 'RISE', 'FALL']");
        expect(tri_mode_value_source).toContain("return 'DIGITOVER'");
        expect(tri_mode_value_source).toContain("return 'DIGITUNDER'");
        expect(tri_mode_value_source).toContain("return 'DIGITEVEN'");
        expect(tri_mode_value_source).toContain("return 'DIGITODD'");
        expect(tri_mode_value_source).toContain("return 'CALL'");
        expect(tri_mode_value_source).toContain("return 'PUT'");
    });

    it('uses one directly editable fixed stake with no Martingale or balance sizing', () => {
        expect(xml_document.querySelector('block[id="tm_init_stake_value"] field[name="NUM"]')?.textContent).toBe('1');
        expect(xml_document.querySelectorAll('block[type="balance"]')).toHaveLength(0);
        expect(xml_document.querySelectorAll('block[type="contract_check_result"]')).toHaveLength(0);
        expect(
            xml_document.querySelector('block[id="tm_advance_sequence"] field[id="tm_sequence_step"]')?.textContent
        ).toBe('Sequence Step');
        expect(xml_text.toLowerCase()).not.toContain('martingale');
        expect(xml_text).not.toContain('DIGITDIFF');
    });

    it('wires every XML variable reference to a declared variable', () => {
        const declared_variable_ids = new Set(
            Array.from(xml_document.querySelectorAll('variables > variable')).map(variable =>
                variable.getAttribute('id')
            )
        );
        const referenced_variable_ids = Array.from(xml_document.querySelectorAll('field[name="VAR"]')).map(field =>
            field.getAttribute('id')
        );

        expect(referenced_variable_ids.every(variable_id => declared_variable_ids.has(variable_id))).toBe(true);
    });

    it('is the exact file published by the Risk Managers catalog', () => {
        const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE_PATH, 'utf8'));
        const tri_mode_entry = catalog.find((bot: { file?: string }) => bot.file === BOT_FILE_NAME);

        expect(tri_mode_entry).toMatchObject({
            name: 'Tri-Mode Regime Switcher (Template Fixed)',
            file: BOT_FILE_NAME,
            description: expect.stringContaining('Over 4, Under 5, Even, Odd, Rise, and Fall'),
        });
    });
});
