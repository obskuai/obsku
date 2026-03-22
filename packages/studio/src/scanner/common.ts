import path from "node:path";
import {
  type ArrayLiteralExpression,
  type Expression,
  type Node as MorphNode,
  Node,
  type ObjectLiteralExpression,
  Project,
  QuoteKind,
  type SourceFile,
  SyntaxKind,
  ts,
} from "ts-morph";

export interface ScanOptions {
  rootDir: string;
}

export interface ExportedObjectMatch {
  exportName: string;
  filePath: string;
  line: number;
  modulePath: string;
  objectLiteral: ObjectLiteralExpression;
}

export function createScanProject(rootDir: string): Project {
  const project = new Project({
    compilerOptions: {
      allowJs: false,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
    },
    manipulationSettings: {
      quoteKind: QuoteKind.Double,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
  });

  project.addSourceFilesAtPaths(path.join(rootDir, "**/*.ts"));

  for (const sourceFile of project.getSourceFiles()) {
    if (shouldSkipFile(sourceFile.getFilePath())) {
      project.removeSourceFile(sourceFile);
    }
  }

  return project;
}

export function shouldSkipFile(filePath: string): boolean {
  const normalizedPath = normalizeSlashes(filePath);
  return (
    normalizedPath.includes("/node_modules/") ||
    normalizedPath.includes("/dist/") ||
    normalizedPath.endsWith(".d.ts") ||
    normalizedPath.endsWith(".test.ts") ||
    normalizedPath.endsWith(".config.ts")
  );
}

export function findExportedObjects(
  sourceFile: SourceFile,
  rootDir: string,
  matcher: (expression: Expression) => ObjectLiteralExpression | undefined
): ExportedObjectMatch[] {
  const matches: ExportedObjectMatch[] = [];

  for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
    const seen = new Set<string>();

    for (const declaration of declarations) {
      const objectLiteral = findObjectLiteralForDeclaration(declaration, matcher);
      if (!objectLiteral) {
        continue;
      }

      const key = `${exportName}:${objectLiteral.getStart()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      matches.push({
        exportName,
        filePath: sourceFile.getFilePath(),
        line: objectLiteral.getStartLineNumber(),
        modulePath: toModulePath(rootDir, sourceFile.getFilePath()),
        objectLiteral,
      });
    }
  }

  return matches;
}

export function getPropertyValue(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string
): Expression | undefined {
  const property = objectLiteral.getProperty(propertyName);
  if (!property) {
    return undefined;
  }

  if (Node.isPropertyAssignment(property)) {
    return property.getInitializer();
  }

  if (Node.isShorthandPropertyAssignment(property)) {
    return property.getNameNode();
  }

  return undefined;
}

export function getObjectLiteral(
  expression: Expression | undefined
): ObjectLiteralExpression | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  return Node.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

export function getArrayLiteral(
  expression: Expression | undefined
): ArrayLiteralExpression | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  return Node.isArrayLiteralExpression(unwrapped) ? unwrapped : undefined;
}

export function getBooleanValue(expression: Expression | undefined): boolean | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  if (!unwrapped) {
    return undefined;
  }
  if (unwrapped.getKind() === SyntaxKind.TrueKeyword) {
    return true;
  }
  if (unwrapped.getKind() === SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

export function getNumberValue(expression: Expression | undefined): number | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  if (!unwrapped) {
    return undefined;
  }
  if (Node.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.getLiteralText());
  }
  if (Node.isPrefixUnaryExpression(unwrapped)) {
    const operand = unwrapped.getOperand();
    if (Node.isNumericLiteral(operand)) {
      const value = Number(operand.getLiteralText());
      return unwrapped.getOperatorToken() === SyntaxKind.MinusToken ? -value : value;
    }
  }
  return undefined;
}

export function getStringValue(expression: Expression | undefined): string | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  if (!unwrapped) {
    return undefined;
  }

  if (Node.isStringLiteral(unwrapped) || Node.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.getLiteralValue();
  }

  if (Node.isTemplateExpression(unwrapped)) {
    if (unwrapped.getTemplateSpans().length === 0) {
      return unwrapped.getHead().getLiteralText();
    }
    return unwrapped.getText();
  }

  if (Node.isArrowFunction(unwrapped) || Node.isFunctionExpression(unwrapped)) {
    const body = unwrapped.getBody();
    if (Node.isBlock(body)) {
      const returnStatement = body.getStatements().find(Node.isReturnStatement);
      const returnExpression = returnStatement?.getExpression();
      return returnExpression
        ? getStringValue(returnExpression as Expression)
        : unwrapped.getText();
    }

    return getStringValue(body as Expression) ?? body.getText();
  }

  return undefined;
}

export function expressionToText(expression: Expression | undefined): string | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  return unwrapped?.getText();
}

export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function toModulePath(rootDir: string, filePath: string): string {
  const relativePath = normalizeSlashes(path.relative(rootDir, filePath));
  return relativePath.replace(/\.ts$/, "");
}

function findObjectLiteralForDeclaration(
  declaration: MorphNode,
  matcher: (expression: Expression) => ObjectLiteralExpression | undefined
): ObjectLiteralExpression | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer) {
      return undefined;
    }

    const match = matcher(initializer);
    if (match) {
      return match;
    }

    return undefined;
  }

  if (Node.isExportAssignment(declaration)) {
    return matcher(declaration.getExpression());
  }

  // Handle cases where the declaration is directly an expression (e.g., default exports)
  if (Node.isExpression(declaration)) {
    return matcher(declaration);
  }

  return undefined;
}

function looksLikeTypedDeclaration(declaration: MorphNode, typeName: string): boolean {
  if (!Node.isVariableDeclaration(declaration)) {
    return false;
  }

  const typeNode = declaration.getTypeNode();
  return Boolean(typeNode && typeNode.getText().includes(typeName));
}

export function unwrapExpression(expression: Expression): Expression {
  let current: Expression = expression;

  while (true) {
    if (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
      continue;
    }

    if (Node.isAsExpression(current) || Node.isTypeAssertion(current)) {
      current = current.getExpression();
      continue;
    }

    if (Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
      continue;
    }

    return current;
  }
}
