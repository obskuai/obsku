import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Clock, MessageSquare, Code, Terminal, AlertCircle } from 'lucide-react';

export const mockEvents = [
  { id: 'evt_1', type: 'message', timestamp: new Date('2026-03-22T10:00:00Z'), data: { role: 'user', content: 'How to use React?' } },
  { id: 'evt_2', type: 'thought', timestamp: new Date('2026-03-22T10:00:05Z'), data: { text: 'I need to explain the basics of React components and state.' } },
  { id: 'evt_3', type: 'tool_call', timestamp: new Date('2026-03-22T10:00:10Z'), data: { name: 'search_docs', args: { query: 'React introduction' } } },
  { id: 'evt_4', type: 'tool_result', timestamp: new Date('2026-03-22T10:00:15Z'), data: { result: 'React is a library for building user interfaces...' } },
  { id: 'evt_5', type: 'message', timestamp: new Date('2026-03-22T10:00:20Z'), data: { role: 'assistant', content: 'React is a popular JavaScript library...' } },
  { id: 'evt_6', type: 'error', timestamp: new Date('2026-03-22T10:05:00Z'), data: { error: 'Failed to fetch additional resources' } },
];

const EventIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'message': return <MessageSquare className="h-4 w-4" />;
    case 'thought': return <Clock className="h-4 w-4" />;
    case 'tool_call': return <Code className="h-4 w-4" />;
    case 'tool_result': return <Terminal className="h-4 w-4" />;
    case 'error': return <AlertCircle className="h-4 w-4 text-destructive" />;
    default: return <Clock className="h-4 w-4" />;
  }
};

const EventBadge = ({ type }: { type: string }) => {
  switch (type) {
    case 'message': return <Badge variant="default">Message</Badge>;
    case 'thought': return <Badge variant="secondary">Thought</Badge>;
    case 'tool_call': return <Badge variant="outline">Tool Call</Badge>;
    case 'tool_result': return <Badge variant="outline">Tool Result</Badge>;
    case 'error': return <Badge variant="destructive">Error</Badge>;
    default: return <Badge variant="secondary">{type}</Badge>;
  }
};

export function SessionDetail() {
  const [openEvents, setOpenEvents] = useState<Record<string, boolean>>({});

  const toggleEvent = (id: string) => {
    setOpenEvents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto h-screen flex flex-col">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-bold">Session sess_1</h1>
          <p className="text-muted-foreground mt-1">How to use React?</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="default">Active</Badge>
          <Badge variant="outline">{mockEvents.length} Events</Badge>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0">
          <CardTitle>Event Timeline</CardTitle>
          <CardDescription>Chronological sequence of session events</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full p-6">
            <div className="space-y-4">
              {mockEvents.map((event) => (
                <Card key={event.id} className="overflow-hidden">
                  <Collapsible
                    open={openEvents[event.id]}
                    onOpenChange={() => toggleEvent(event.id)}
                  >
                    <div className="flex items-center justify-between p-4 bg-muted/50">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-background border">
                          <EventIcon type={event.type} />
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <EventBadge type={event.type} />
                            <span className="text-xs text-muted-foreground font-mono">
                              {format(event.timestamp, 'HH:mm:ss.SSS')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-9 p-0">
                          {openEvents[event.id] ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                          <span className="sr-only">Toggle</span>
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <Separator />
                      <div className="p-4 bg-muted/20">
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
