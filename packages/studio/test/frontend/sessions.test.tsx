import { describe, it, expect } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionList, mockSessions } from '../../src/frontend/pages/SessionList';
import { SessionDetail, mockEvents } from '../../src/frontend/pages/SessionDetail';
import * as React from 'react';

if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
  window.HTMLElement.prototype.releasePointerCapture = function() {};
}

describe('SessionList', () => {
  it('should render the list of sessions', () => {
    render(<SessionList />);
    
    expect(screen.getByText('Sessions')).toBeTruthy();
    
    for (const session of mockSessions) {
      expect(screen.getByText(session.id)).toBeTruthy();
      expect(screen.getByText(session.title)).toBeTruthy();
    }
    
    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });
});

describe('SessionDetail', () => {
  it('should render session metadata', () => {
    render(<SessionDetail />);
    
    expect(screen.getByText('Session sess_1')).toBeTruthy();
    expect(screen.getByText('How to use React?')).toBeTruthy();
    expect(screen.getByText(`${mockEvents.length} Events`)).toBeTruthy();
  });

  it('should render event timeline', () => {
    render(<SessionDetail />);
    
    expect(screen.getByText('Event Timeline')).toBeTruthy();
    
    expect(screen.getAllByText('Message').length).toBeGreaterThan(0);
    expect(screen.getByText('Thought')).toBeTruthy();
    expect(screen.getByText('Tool Call')).toBeTruthy();
  });

  it('should toggle event details', () => {
    render(<SessionDetail />);
    
    const toggleButtons = screen.getAllByRole('button', { name: /toggle/i });
    expect(toggleButtons.length).toBe(mockEvents.length);
    
    fireEvent.click(toggleButtons[0]);
    
    expect(screen.getByText(/"role": "user"/)).toBeTruthy();
    expect(screen.getByText(/"content": "How to use React\?"/)).toBeTruthy();
  });
});
