/**
 * Hook point run right after an account is created. Task 5 fills this in: it joins the new user
 * to every trip that has a pending email invite for their address.
 */
export async function acceptEmailInvites(user: { id: string; email: string }): Promise<void> {
  void user;
}
