import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Last {{ count }} digits are {{ condition }} digit {{ digit }}', {
                count: '%1',
                condition: '%2',
                digit: '%3',
            }),
            args0: [
                {
                    type: 'input_value',
                    name: 'COUNT',
                    check: 'Number',
                },
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('less than'), 'lt'],
                        [localize('greater than'), 'gt'],
                        [localize('less than or equal to'), 'lte'],
                        [localize('greater than or equal to'), 'gte'],
                        [localize('equal to'), 'eq'],
                        [localize('different from'), 'neq'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'DIGIT',
                    check: 'Number',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Checks if the last N digits all meet the selected condition'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Last Digits Condition'),
            description: localize('Checks if the last N digits meet the specified condition.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const count =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'COUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_NONE
        ) || 3;
    const digit =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'DIGIT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_NONE
        ) || 4;
    const condition = block.getFieldValue('CONDITION');
    const operator_map = {
        eq: '===',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
        neq: '!==',
    };
    const operator = operator_map[condition] || '<';
    const condition_text_map = {
        eq: 'equal to',
        gt: 'greater than',
        gte: 'greater than or equal to',
        lt: 'less than',
        lte: 'less than or equal to',
        neq: 'different from',
    };
    const condition_text = condition_text_map[condition] || 'less than';

    return [
        `(function () {
            var digits = Bot.getLastDigitList().slice(-Math.max(1, Number(${count}) || 1));
            var target = Number(${digit});
            var requestedCount = Math.max(1, Number(${count}) || 1);
            var index = 0;
            var result = true;
            var digitsText = '';
            if (!digits.length) {
                Bot.notify({
                    className: 'journal__text--analysis',
                    message:
                        'Scanning exact last ' +
                        requestedCount +
                        ' digits: none available yet. Result: False.',
                    sound: '',
                    analysis_append: true,
                    analysis_key: '${block.id}',
                });
                return false;
            }
            digitsText = digits.join(', ');
            for (index = 0; index < digits.length; index += 1) {
                if (!(Number(digits[index]) ${operator} target)) {
                    result = false;
                    break;
                }
            }
            Bot.notify({
                className: 'journal__text--analysis',
                message:
                    'Scanning exact last ' +
                    requestedCount +
                    ' digits: [' +
                    digitsText +
                    ']. Digits available: ' +
                    digits.length +
                    '. Rule: every digit is ${condition_text} ' +
                    target +
                    '. Result: ' +
                    (result ? 'True' : 'False') +
                    '.',
                sound: '',
                analysis_append: true,
                analysis_key: '${block.id}',
            });
            return result;
        })()`,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL,
    ];
};
