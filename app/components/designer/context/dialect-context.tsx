"use client";

import { createContext, useContext } from "react";
import type { Dialect } from "@/app/lib/schema";

/**
 * The diagram's database, on its own: a string that changes only when the user
 * switches it, so a card reading it re-renders then and never on an edit --
 * which reading it out of `SchemaContext` would do.
 */
export const DialectContext = createContext<Dialect>("oracle");

export const useDialect = () => useContext(DialectContext);
