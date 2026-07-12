import React, { useState } from 'react';
import { API_BASE } from '@/utils/api-base';
import './analysistool.scss';

const EXAMPLE_PROMPTS = [
    'Give me a read on Volatility 75 Index right now — any bias I should be watching for?',
    'What should I watch for when trading Boom 1000 after a big spike?',
    "Explain what a rising Z-score means for a digit-based strategy on R_25.",
];

const Analysistool = () => {
    const [prompt, setPrompt] = useState('');
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const runAnalysis = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || isLoading) return;

        setIsLoading(true);
        setError(null);
        setAnalysis(null);

        try {
            const res = await fetch(`${API_BASE}/groq/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: trimmed }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data?.error || 'Analysis failed. Please try again.');
                return;
            }

            setAnalysis(data.analysis);
        } catch {
            setError('Could not reach the analysis service. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__header'>
                <h1>Mr Chris Analysis</h1>
                <p>Ask about a market, a setup, or a strategy idea — powered by Groq.</p>
            </div>

            <div className='analysis-tool__examples'>
                {EXAMPLE_PROMPTS.map(example => (
                    <button
                        key={example}
                        type='button'
                        className='analysis-tool__example-chip'
                        onClick={() => {
                            setPrompt(example);
                            runAnalysis(example);
                        }}
                        disabled={isLoading}
                    >
                        {example}
                    </button>
                ))}
            </div>

            <form
                className='analysis-tool__form'
                onSubmit={e => {
                    e.preventDefault();
                    runAnalysis(prompt);
                }}
            >
                <textarea
                    className='analysis-tool__input'
                    placeholder='Ask about a market or strategy…'
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    rows={4}
                />
                <button type='submit' className='analysis-tool__submit' disabled={isLoading || !prompt.trim()}>
                    {isLoading ? 'Analyzing…' : 'Analyze'}
                </button>
            </form>

            {error && <div className='analysis-tool__error'>{error}</div>}

            {analysis && (
                <div className='analysis-tool__result'>
                    {analysis.split('\n').map((line, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <p key={i}>{line}</p>
                    ))}
                </div>
            )}

            {!analysis && !error && !isLoading && (
                <div className='analysis-tool__empty'>Your analysis will appear here.</div>
            )}
        </div>
    );
};

export default Analysistool;
