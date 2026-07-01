type TStoredJournalEntry = Record<string, unknown>;

export const normalizeJournalMessage = (message: unknown, fallback = 'Unknown journal message') => {
    if (typeof message === 'string') {
        return message || fallback;
    }

    if (message instanceof Error) {
        return message.message || message.name || fallback;
    }

    if (message && typeof message === 'object') {
        const nested_message = (message as { message?: unknown }).message;
        if (typeof nested_message === 'string' && nested_message) {
            return nested_message;
        }

        try {
            const serialized_message = JSON.stringify(message);
            if (serialized_message && serialized_message !== '{}') {
                return serialized_message;
            }
        } catch {
            return fallback;
        }
    }

    if (message !== undefined && message !== null) {
        const string_message = String(message);
        return string_message || fallback;
    }

    return fallback;
};

export const normalizeJournalFilters = (stored_filters: unknown, valid_filters: string[]) => {
    if (!Array.isArray(stored_filters)) {
        return [...valid_filters];
    }

    const normalized_filters = Array.from(
        new Set(stored_filters.filter(filter => typeof filter === 'string' && valid_filters.includes(filter)))
    );

    return normalized_filters.length ? normalized_filters : [...valid_filters];
};

export const normalizeStoredJournalEntries = (
    stored_entries: unknown,
    valid_message_types: string[],
    fallback_message_type: string,
    create_id: () => string
) => {
    if (!Array.isArray(stored_entries)) return [];

    return stored_entries.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];

        const stored_entry = entry as TStoredJournalEntry;
        const message_type =
            typeof stored_entry.message_type === 'string' && valid_message_types.includes(stored_entry.message_type)
                ? stored_entry.message_type
                : fallback_message_type;
        const extra =
            stored_entry.extra && typeof stored_entry.extra === 'object' && !Array.isArray(stored_entry.extra)
                ? stored_entry.extra
                : {};

        return [
            {
                ...stored_entry,
                className: typeof stored_entry.className === 'string' ? stored_entry.className : '',
                extra,
                message: normalizeJournalMessage(stored_entry.message),
                message_type,
                unique_id:
                    typeof stored_entry.unique_id === 'string' && stored_entry.unique_id
                        ? stored_entry.unique_id
                        : create_id(),
            },
        ];
    });
};
