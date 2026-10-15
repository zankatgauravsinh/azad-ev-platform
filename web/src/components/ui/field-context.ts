import { createContext, useContext } from 'react';

/**
 * The id a FormField gives its control. Input, Textarea and SelectTrigger use it when no `id` is passed, so a
 * control inside <FormField label="…"> is named by that label without wiring ids by hand.
 */
export const FieldIdContext = createContext<string | undefined>(undefined);

export const useFieldId = (explicit?: string): string | undefined => {
  const fromField = useContext(FieldIdContext);
  return explicit ?? fromField;
};
