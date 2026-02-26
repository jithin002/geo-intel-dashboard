/**
 * Chat Interface Component
 * Floating chat panel for conversational agent
 */

import React, { useState, useEffect, useRef } from 'react';
import './ChatInterface.css';

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface ChatInterfaceProps {
    messages: Message[];
    onSendMessage: (message: string) => void;
    isAITyping: boolean;
    isOpen: boolean;
    onToggle: () => void;
    onClearChat?: () => void;
    selectedWard?: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    onSendMessage,
    isAITyping,
    isOpen,
    onToggle,
    onClearChat,
    selectedWard
}) => {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isAITyping]);

    // Focus input when chat opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSend = () => {
        const trimmed = inputValue.trim();
        if (trimmed && !isAITyping) {
            onSendMessage(trimmed);
            setInputValue('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (date: Date) => {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!isOpen) {
        return (
            <button
                onClick={onToggle}
                className="chat-toggle-button"
                aria-label="Open chat"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                {messages.length > 0 && (
                    <div className="chat-badge">{messages.length}</div>
                )}
            </button>
        );
    }

    return (
        <div className="chat-container">
            {/* Header */}
            <div className="chat-header">
                <div className="chat-header-content">
                    <div className="chat-title">
                        <span className="chat-icon">🤖</span>
                        <div>
                            <div className="chat-title-text">Geo-Intel Assistant</div>
                            <div className="chat-subtitle">
                                {selectedWard ? `📍 ${selectedWard}` : 'Ask me anything'}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {onClearChat && messages.length > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm('Are you sure you want to clear the conversation history?')) {
                                        onClearChat();
                                    }
                                }}
                                className="chat-close-button"
                                title="Clear conversation"
                                aria-label="Clear chat"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={onToggle}
                            className="chat-close-button"
                            aria-label="Close chat"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="chat-welcome">
                        <div className="chat-welcome-icon">👋</div>
                        <h3>Welcome to Geo-Intel Assistant!</h3>
                        <p>I can help you with:</p>
                        <ul>
                            <li>Finding top gym locations</li>
                            <li>Analyzing competition levels</li>
                            <li>Checking demand drivers</li>
                            <li>Market gap analysis</li>
                        </ul>
                        <div className="chat-suggestions">
                            <button onClick={() => setInputValue("Show me the top 3 spots")}>
                                Top 3 spots
                            </button>
                            <button onClick={() => setInputValue("Areas with low competition")}>
                                Low competition
                            </button>
                            <button onClick={() => setInputValue("What's the best untapped area?")}>
                                Untapped areas
                            </button>
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
                    >
                        <div className="chat-message-content">
                            <div className="chat-message-text">
                                {msg.content.split('\n').map((line, i) => {
                                    // Handle markdown-style bold
                                    const parts = line.split(/(\*\*.*?\*\*)/g);
                                    return (
                                        <div key={i}>
                                            {parts.map((part, j) => {
                                                if (part.startsWith('**') && part.endsWith('**')) {
                                                    return <strong key={j}>{part.slice(2, -2)}</strong>;
                                                }
                                                return <span key={j}>{part}</span>;
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="chat-message-time">{formatTime(msg.timestamp)}</div>
                        </div>
                    </div>
                ))}

                {isAITyping && (
                    <div className="chat-message chat-message-assistant">
                        <div className="chat-message-content">
                            <div className="chat-typing-indicator">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="chat-input-container">
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask me anything..."
                    className="chat-input"
                    disabled={isAITyping}
                />
                <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isAITyping}
                    className="chat-send-button"
                    aria-label="Send message"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </button>
            </div>
        </div>
    );
};
