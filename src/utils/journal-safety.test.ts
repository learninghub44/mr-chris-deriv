import {
    normalizeJournalFilters,
    normalizeJournalMessage,
    normalizeStoredJournalEntries,
} from '@/utils/journal-safety';

describe('journal safety', () => {
    const valid_filters = ['error', 'notify', 'success'];

    it('converts Error objects and API error objects into renderable text', () => {
        expect(normalizeJournalMessage(new Error('Proposal is not ready'))).toBe('Proposal is not ready');
        expect(normalizeJournalMessage({ message: 'Buy response is missing' })).toBe('Buy response is missing');
    });

    it('restores all filters when saved filter data is empty or corrupt', () => {
        expect(normalizeJournalFilters([], valid_filters)).toEqual(valid_filters);
        expect(normalizeJournalFilters('error', valid_filters)).toEqual(valid_filters);
        expect(normalizeJournalFilters(['error', 'unknown', 'error'], valid_filters)).toEqual(['error']);
    });

    it('repairs cached entries that are missing UI fields', () => {
        expect(
            normalizeStoredJournalEntries(
                [{ message: { message: 'Recovered error' }, message_type: 'error' }],
                valid_filters,
                'notify',
                () => 'generated-id'
            )
        ).toEqual([
            {
                className: '',
                extra: {},
                message: 'Recovered error',
                message_type: 'error',
                unique_id: 'generated-id',
            },
        ]);
    });

    it('drops non-object cache entries without throwing', () => {
        expect(normalizeStoredJournalEntries([null, 'broken'], valid_filters, 'notify', () => 'id')).toEqual([]);
    });
});
