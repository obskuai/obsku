import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { format } from 'date-fns';

export const mockSessions = [
  { id: 'sess_1', title: 'How to use React?', status: 'active', createdAt: new Date('2026-03-22T10:00:00Z'), messageCount: 5 },
  { id: 'sess_2', title: 'Debug memory leak', status: 'completed', createdAt: new Date('2026-03-21T15:30:00Z'), messageCount: 24 },
  { id: 'sess_3', title: 'Setup database', status: 'error', createdAt: new Date('2026-03-20T09:15:00Z'), messageCount: 2 },
];

export function SessionList() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Sessions</h1>
      </div>
      
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Messages</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockSessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="font-mono text-xs">{session.id}</TableCell>
                <TableCell>{session.title}</TableCell>
                <TableCell>
                  <Badge variant={session.status === 'active' ? 'default' : session.status === 'error' ? 'destructive' : 'secondary'}>
                    {session.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(session.createdAt, 'MMM d, yyyy HH:mm')}
                </TableCell>
                <TableCell className="text-right">{session.messageCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
