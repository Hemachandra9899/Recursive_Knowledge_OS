import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderBudget, getRouteBudgets } from "../search-provider-config.js";

describe("getProviderBudget", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns defaults when no env overrides are set", () => {
    const budget = getProviderBudget("tavily");
    expect(budget.enabled).toBe(true);
    expect(budget.maxResults).toBe(10);
  });

  it("reads env overrides for maxResults", () => {
    process.env.TAVILY_MAX_RESULTS = "5";
    const budget = getProviderBudget("tavily");
    expect(budget.maxResults).toBe(5);
  });

  it("reads env overrides for enabled", () => {
    process.env.GITHUB_ENABLED = "false";
    const budget = getProviderBudget("github");
    expect(budget.enabled).toBe(false);
  });
});

describe("getRouteBudgets", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("docs route gives tavily higher budget and disables github", () => {
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.maxResults).toBe(8);
    expect(budgets.github.enabled).toBe(false);
    expect(budgets.firecrawl.enabled).toBe(true);
  });

  it("freshness route gives tavily highest budget", () => {
    const budgets = getRouteBudgets("freshness");
    expect(budgets.tavily.maxResults).toBe(10);
    expect(budgets.firecrawl.maxResults).toBe(4);
    expect(budgets.github.enabled).toBe(false);
  });

  it("code route gives github highest budget", () => {
    const budgets = getRouteBudgets("code");
    expect(budgets.github.maxResults).toBe(10);
    expect(budgets.tavily.maxResults).toBe(6);
    expect(budgets.firecrawl.maxResults).toBe(4);
  });

  it("env override of maxResults is reflected in route budgets", () => {
    process.env.TAVILY_MAX_RESULTS = "3";
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.maxResults).toBe(3);
  });

  it("env disable of provider is reflected in route budgets", () => {
    process.env.TAVILY_ENABLED = "false";
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.enabled).toBe(false);
  });
});
