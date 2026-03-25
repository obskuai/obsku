import { NavLink } from "react-router-dom"
import { 
  LayoutDashboard, 
  Bot, 
  Network, 
  ListTree, 
  MessageSquare 
} from "lucide-react"
import { cn } from "../../lib/utils"

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Agents", href: "/agents", icon: Bot },
  { name: "Graphs", href: "/graphs", icon: Network },
  { name: "Sessions", href: "/sessions", icon: ListTree },
  { name: "Chat", href: "/chat", icon: MessageSquare },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  onNavClick?: () => void
}

export function Sidebar({ className, onNavClick, ...props }: SidebarProps) {
  return (
    <div className={cn("pb-12 h-full flex flex-col", className)} {...props}>
      <div className="space-y-4 py-4">
        <div className="px-3 py-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
            Obsku Studio
          </h2>
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={onNavClick}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-muted",
                    isActive 
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" 
                      : "text-muted-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
