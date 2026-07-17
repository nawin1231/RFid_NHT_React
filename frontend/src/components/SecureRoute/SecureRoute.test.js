import React from "react";
import { shallow } from "enzyme";
import SecureRoute from "./SecureRoute";

describe("SecureRoute", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<SecureRoute />);
    expect(wrapper).toMatchSnapshot();
  });
});
