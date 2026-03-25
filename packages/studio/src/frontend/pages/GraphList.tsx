import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export default function GraphList() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Graphs</h1>
          <p className="text-muted-foreground">Manage your workflow graphs</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Graphs</CardTitle>
          <CardDescription>
            Graph list will be implemented here
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No graphs found</p>
        </CardContent>
      </Card>
    </div>
  );
}
