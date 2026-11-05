"use client";

import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { ChevronDownIcon, LightbulbIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayout, useSchema, useSelect } from "@/app/hooks";
import { LINT_FAMILIES, LINT_RULES, type LintFamily } from "@/app/lib/lint";

const LIMIT = 40;
const FAMILIES = Object.keys(LINT_FAMILIES) as LintFamily[];

/** The validation drawer pinned under the panel footer: errors and warnings, then lint suggestions. */
export function Issues({ readOnly = false }: { readOnly?: boolean }) {
  const { issues, errors, suggestions, fixSuggestion, setLintRules, schema } = useSchema();
  const { issuesOpen, setIssuesOpen } = useLayout();
  const { selectTable } = useSelect();
  // Per-viewer and per-session: hiding advice is a reading preference, not a project setting like the rule toggles.
  const [showSuggestions, setShowSuggestions] = useState(true);
  const disabled = new Set(schema.lint?.disabled ?? []);
  const enabled = LINT_RULES.filter((rule) => !disabled.has(rule.id)).map((rule) => rule.id);
  const shown = showSuggestions ? suggestions.slice(0, Math.max(0, LIMIT - issues.length)) : [];
  return (
    <Collapsible
      className="issues-bar"
      isExpanded={issuesOpen}
      onExpandedChange={setIssuesOpen}
    >
      <CollapsibleTrigger className="issues-head">
        <TriangleAlertIcon className={errors.length ? "warn danger" : "warn"}
        />
        <span>Issues</span>
        <Badge variant={errors.length ? "destructive" : "secondary"}>
          {issues.length}
        </Badge>
        {Boolean(suggestions.length) && (
          <Badge variant="outline" className="issues-suggestion-count" aria-label={`${suggestions.length} suggestions`}>
            <LightbulbIcon aria-hidden="true" />
            {suggestions.length}
          </Badge>
        )}
        <ChevronDownIcon className="issues-chevron" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="issues-toolbar">
          <Button variant="ghost" size="xs" onClick={() => setShowSuggestions((value) => !value)} aria-pressed={showSuggestions}>
            {showSuggestions ? "Hide suggestions" : "Show suggestions"}
          </Button>
          {!readOnly && (
            <DropdownMenuTrigger>
              <AriaButton className="issues-rules" aria-label="Choose lint rules">
                <SlidersHorizontalIcon size={13} aria-hidden="true" />
                Rules
              </AriaButton>
              <DropdownMenu
                placement="top end"
                className="w-auto max-h-96"
                aria-label="Lint rules"
                selectionMode="multiple"
                selectedKeys={enabled}
                onSelectionChange={(keys) => setLintRules(keys === "all" ? enabled.concat(LINT_RULES.map((rule) => rule.id)) : [...keys].map(String))}
              >
                {FAMILIES.map((family) => (
                  <DropdownMenuGroup key={family}>
                    <DropdownMenuLabel>{LINT_FAMILIES[family]}</DropdownMenuLabel>
                    {LINT_RULES.filter((rule) => rule.family === family).map((rule) => (
                      <DropdownMenuItem key={rule.id} id={rule.id}>{rule.title}</DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenu>
            </DropdownMenuTrigger>
          )}
        </div>
        <ScrollArea className="issues-list">
          {!issues.length && !shown.length ? (
            <p className="issues-empty">No problems found.</p>
          ) : (
            <>
              {issues.slice(0, LIMIT).map((issue) => (
                <Button
                  variant="ghost"
                  className={`issue ${issue.severity}`}
                  key={`${issue.message}-${issue.columnId ?? issue.tableId ?? ""}`}
                  onClick={() => issue.tableId && selectTable(issue.tableId)}
                >
                  {issue.message}
                </Button>
              ))}
              {shown.map((finding) => (
                <div className="issue-row" key={finding.key}>
                  <Button variant="ghost" className="issue suggestion" onClick={() => selectTable(finding.tableId)}>
                    {finding.message}
                  </Button>
                  {finding.fix && !readOnly && (
                    <Button variant="secondary" size="xs" className="issue-fix" onClick={() => fixSuggestion(finding)}>
                      {finding.fix.label}
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
