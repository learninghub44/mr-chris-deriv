import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const getBlockValueCode = (block, input_name, fallback = '0') =>
    window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        input_name,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_NONE
    ) || fallback;

const getAnalysisMetadata = target_block => {
    if (!target_block) return null;

    switch (target_block.type) {
        case 'over_under_percentage': {
            const condition = target_block.getFieldValue('CONDITION') === 'under' ? localize('Under') : localize('Over');
            const digit = getBlockValueCode(target_block, 'DIGIT');
            const count = getBlockValueCode(target_block, 'COUNT', '100');
            return {
                label_expression: `'${condition} % for digit ' + Number(${digit}) + ' in last ' + Number(${count}) + ' ticks'`,
                value_type: 'percent',
            };
        }
        case 'even_odd_percentage': {
            const parity = target_block.getFieldValue('PARITY') === 'odd' ? localize('Odd') : localize('Even');
            const count = getBlockValueCode(target_block, 'COUNT', '1000');
            return {
                label_expression: `'${parity} % in last ' + Number(${count}) + ' digits'`,
                value_type: 'percent',
            };
        }
        case 'match_differ_percentage': {
            const mode = target_block.getFieldValue('MODE') === 'differ' ? localize('Differ') : localize('Match');
            const digit = getBlockValueCode(target_block, 'DIGIT');
            const count = getBlockValueCode(target_block, 'COUNT', '1000');
            return {
                label_expression:
                    `'${mode} % for digit ' + Number(${digit}) + ' in last ' + Number(${count}) + ' ticks'`,
                value_type: 'percent',
            };
        }
        case 'rise_fall_percentage': {
            const direction =
                target_block.getFieldValue('DIRECTION') === 'fall' ? localize('Fall') : localize('Rise');
            const count = getBlockValueCode(target_block, 'COUNT', '1000');
            return {
                label_expression: `'${direction} % in last ' + Number(${count}) + ' ticks'`,
                value_type: 'percent',
            };
        }
        case 'digit_frequency_analysis': {
            const rank = target_block.getFieldValue('RANK') === 'least' ? localize('Least') : localize('Most');
            const count = getBlockValueCode(target_block, 'COUNT', '1000');
            return {
                label_expression: `'${rank} frequent digit from last ' + Number(${count}) + ' digits'`,
                value_type: 'number',
            };
        }
        default:
            return null;
    }
};

window.Blockly.Blocks.logic_compare = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: '%1 %2 %3',
            args0: [
                {
                    type: 'input_value',
                    name: 'A',
                },
                {
                    type: 'field_dropdown',
                    name: 'OP',
                    options: [
                        ['=', 'EQ'],
                        ['\u2260', 'NEQ'],
                        ['\u200F<', 'LT'],
                        ['\u200F\u2264', 'LTE'],
                        ['\u200F>', 'GT'],
                        ['\u200F\u2265', 'GTE'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'B',
                },
            ],
            inputsInline: true,
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Compares two values'),
            category: window.Blockly.Categories.Logic,
        };
    },
    meta() {
        return {
            display_name: localize('Compare'),
            description: localize('This block compares two values and is used to build a conditional structure.'),
        };
    },
    getRequiredValueInputs() {
        return {
            A: null,
            B: null,
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.logic_compare = block => {
    const operatorMapping = {
        EQ: '==',
        NEQ: '!=',
        LT: '<',
        LTE: '<=',
        GT: '>',
        GTE: '>=',
    };

    const operator = operatorMapping[block.getFieldValue('OP') || 'EQ'];
    const order = ['==', '!='].includes(operator)
        ? window.Blockly.JavaScript.javascriptGenerator.ORDER_EQUALITY
        : window.Blockly.JavaScript.javascriptGenerator.ORDER_RELATIONAL;

    const argument0 = window.Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'A', order) || 'false';
    const argument1 = window.Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'B', order) || 'false';
    const analysis_block_a = getAnalysisMetadata(block.getInputTargetBlock('A'));
    const analysis_block_b = getAnalysisMetadata(block.getInputTargetBlock('B'));

    if (analysis_block_a || analysis_block_b) {
        const analysis_side = analysis_block_a ? 'left' : 'right';
        const analysis_metadata = analysis_block_a || analysis_block_b;
        const target_side = analysis_side === 'left' ? 'right' : 'left';
        const value_format =
            analysis_metadata.value_type === 'percent'
                ? `Math.round(${analysis_side} * 100) / 100 + '%'`
                : `String(${analysis_side})`;
        const code = `(function () {
            var left = ${argument0};
            var right = ${argument1};
            var result = left ${operator} right;
            var analysisLabel = ${analysis_metadata.label_expression};
            var analysisValue = ${value_format};
            var targetValue = String(${target_side});
            var message = result
                ? 'Condition met: ' + analysisLabel + ' is ' + analysisValue + '. Purchasing contract.'
                : 'Waiting: ' + analysisLabel + ' is ' + analysisValue + '. Target ' + '${operator}' + ' ' + targetValue + '.';
            Bot.notify({
                className: 'journal__text--analysis',
                message: message,
                sound: '',
                analysis_append: true,
                analysis_key: '${block.id}',
            });
            return result;
        })()`;

        return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
    }

    const code = `${argument0} ${operator} ${argument1}`;
    return [code, order];
};
